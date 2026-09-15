async (page) => {
  const origin = "http://127.0.0.1:5181";
  const results = [];
  const pageErrors = [];
  const keyPageRequests = [];
  const mutationRequests = [];
  const allKeys = [];
  const groups = [
    { id: 1, name: "默认分组", rate_multiplier: 1 },
    { id: 2, name: "开发分组", rate_multiplier: 2 },
  ];
  let failKeys = false;
  let failGroups = false;
  let failSettings = false;
  let failUsage = false;

  await page.unrouteAll({ behavior: "wait" });

  const check = (name, condition, details = {}) => {
    if (!condition) throw new Error(name + ": " + JSON.stringify(details));
    results.push({ name, passed: true, ...details });
  };

  const longKey = "sk-" + "x".repeat(180) + "-end";
  for (let i = 1; i <= 123; i += 1) {
    const status = i === 3 ? "quota_exhausted" : i === 4 ? "expired" : i === 2 ? "inactive" : "active";
    const groupId = i % 2 === 0 ? 2 : 1;
    allKeys.push({
      id: i,
      user_id: 99,
      key: i === 123 ? longKey : "sk-fixture-" + String(i).padStart(3, "0") + "-abcdefghijklmnopqrstuvwxyz",
      name: i === 123 ? "长密钥 123" : "测试密钥 " + i,
      group_id: groupId,
      status,
      ip_whitelist: i === 1 ? ["192.168.1.0/24"] : [],
      ip_blacklist: [],
      last_used_at: null,
      last_used_ip: null,
      quota: i === 3 ? 10 : i === 1 ? 100 : 0,
      quota_used: i === 3 ? 10 : i === 1 ? 12.5 : 0,
      expires_at: i === 4 ? "2026-08-01T00:00:00Z" : null,
      created_at: "2026-09-09T00:00:00Z",
      updated_at: "2026-09-09T00:00:00Z",
      current_concurrency: i % 4,
      group: groups.find(group => group.id === groupId),
      rate_limit_5h: i === 1 ? 20 : 0,
      rate_limit_1d: i === 1 ? 100 : 0,
      rate_limit_7d: i === 1 ? 500 : 0,
      usage_5h: 2,
      usage_1d: 5,
      usage_7d: 12,
      window_5h_start: null,
      window_1d_start: null,
      window_7d_start: null,
      reset_5h_at: null,
      reset_1d_at: null,
      reset_7d_at: null,
    });
  }

  const fulfill = (route, data, status = 200, message = "夹具请求失败") => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status >= 400 ? { code: status, message } : { code: 0, data }),
  });

  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async value => { window.__fixtureCopiedText = value; },
      },
    });
    localStorage.setItem("auth_token", "fixture-only-token");
  });
  await page.route(origin + "/health", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "ok" }),
  }));

  await page.route(origin + "/api/**", async route => {
    const request = route.request();
    const requestUrl = request.url();
    const path = requestUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = request.method();

    if (path.endsWith("/auth/me")) {
      return fulfill(route, {
        id: 99, username: "N02 夹具用户", email: "n02@example.invalid", role: "user",
        status: "active", balance: 0, concurrency: 5,
      });
    }
    if (path.endsWith("/admin/compliance/status")) return fulfill(route, { required: false });
    if (path.endsWith("/settings/public")) {
      if (failSettings) return fulfill(route, null, 503, "公共设置夹具失败");
      return fulfill(route, { api_base_url: "https://api.fixture.invalid/v1" });
    }
    if (path.endsWith("/groups/available")) {
      if (failGroups) return fulfill(route, null, 503, "分组夹具失败");
      return fulfill(route, groups);
    }
    if (path.endsWith("/usage/dashboard/api-keys-usage")) {
      if (failUsage) return fulfill(route, null, 503, "用量夹具失败");
      const stats = Object.fromEntries(allKeys.map(key => [String(key.id), {
        today_actual_cost: key.id === 1 ? 1.2345 : 0.25,
        total_actual_cost: key.id === 1 ? 12.3456 : 2.5,
      }]));
      return fulfill(route, { stats });
    }
    if (path.endsWith("/keys") && method === "GET") {
      if (failKeys) return fulfill(route, null, 503, "密钥列表夹具失败");
      const pageNumber = Number(requestUrl.match(/[?&]page=(\d+)/)?.[1] || 1);
      const pageSize = Number(requestUrl.match(/[?&]page_size=(\d+)/)?.[1] || 100);
      keyPageRequests.push(pageNumber);
      const start = (pageNumber - 1) * pageSize;
      return fulfill(route, {
        items: allKeys.slice(start, start + pageSize),
        total: allKeys.length,
        page: pageNumber,
        page_size: pageSize,
        pages: Math.ceil(allKeys.length / pageSize),
      });
    }

    if ((method === "POST" && path.endsWith("/keys")) ||
        (["PUT", "PATCH", "DELETE"].includes(method) && /\/keys\/\d+$/.test(path))) {
      mutationRequests.push({ method, path });
      return fulfill(route, method === "DELETE" ? { message: "fixture delete intercepted" } : allKeys[0]);
    }

    return fulfill(route, {});
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/?noboot&unlocked");
  await page.waitForFunction(() => Boolean(window.__macOS?.wm));
  await page.evaluate(() => {
    for (const win of [...window.__macOS.wm.windows.value]) window.__macOS.wm.closeWindow(win.id);
    window.__macOS.systemStore.setAppearance("light");
    window.__macOS.wm.openApp("keychain");
  });

  const win = page.getByRole("region", { name: "API 密钥", exact: true });
  await win.waitFor();
  await win.locator("tbody tr").nth(122).waitFor({ timeout: 20000 });
  const rows = win.locator("tbody tr");
  check("分页加载全部密钥", await rows.count() === 123 && keyPageRequests.includes(1) && keyPageRequests.includes(2), {
    rowCount: await rows.count(), requestedPages: keyPageRequests,
  });

  const search = win.getByRole("textbox", { name: "搜索密钥", exact: true });
  await search.fill("长密钥 123");
  check("名称搜索只保留匹配项", await rows.count() === 1 && await win.getByText("长密钥 123", { exact: true }).count() === 1);
  await search.fill("");
  await win.getByRole("button", { name: /^已过期/ }).click();
  check("状态筛选可用", await rows.count() === 1 && await rows.first().getByText("已过期", { exact: true }).count() === 1);
  await win.getByRole("button", { name: /^全部密钥/ }).click();
  await win.getByRole("button", { name: /开发分组/ }).click();
  check("分组筛选可用", await rows.count() === 61 && (await rows.first().innerText()).includes("测试密钥 2"));
  await win.getByRole("button", { name: /^全部密钥/ }).click();

  const longRow = rows.filter({ hasText: "长密钥 123" });
  await longRow.getByRole("button", { name: "复制 长密钥 123 的完整密钥", exact: true }).click();
  const copiedKey = await page.evaluate(() => window.__fixtureCopiedText || "");
  check("复制使用完整密钥", copiedKey === longKey, { copiedLength: copiedKey.length });

  const tableLayout = await win.locator(".keychain-table").evaluate(table => {
    const app = table.closest(".keychain-app");
    const longRow = [...table.querySelectorAll("tbody tr")].find(row => row.textContent.includes("长密钥 123"));
    const longValue = longRow?.querySelector(".app-long-value");
    return {
      appScrollWidth: app?.scrollWidth || 0,
      appClientWidth: app?.clientWidth || 0,
      longValueScrollWidth: longValue?.scrollWidth || 0,
      longValueClientWidth: longValue?.clientWidth || 0,
      tableScrollWidth: table.scrollWidth,
      tableClientWidth: table.clientWidth,
    };
  });
  check("长密钥不撑破桌面布局",
    tableLayout.appScrollWidth <= tableLayout.appClientWidth + 1 &&
    tableLayout.longValueScrollWidth <= tableLayout.longValueClientWidth + 1, tableLayout);

  await longRow.getByRole("button", { name: "打开 长密钥 123 的接入指南", exact: true }).click();
  const useSheet = win.getByRole("dialog", { name: "接入指引 · 长密钥 123", exact: true });
  await useSheet.waitFor();
  await useSheet.getByRole("button", { name: "cURL", exact: true }).click();
  await useSheet.getByRole("button", { name: "一键复制", exact: true }).click();
  const curlSnippet = await page.evaluate(() => window.__fixtureCopiedText || "");
  check("cURL 复制内容保留真实换行", curlSnippet.includes("\n") && !curlSnippet.includes("\\n  -H"), {
    lineCount: curlSnippet.split("\n").length,
  });
  await page.keyboard.press("Escape");
  await useSheet.waitFor({ state: "detached" });

  await win.getByRole("button", { name: "创建 API 密钥", exact: true }).click();
  const createSheet = win.getByRole("dialog", { name: "创建新 API 密钥", exact: true });
  await createSheet.waitFor();
  check("创建表单字段各出现一次",
    await createSheet.getByText("IP 访问控制", { exact: true }).count() === 1 &&
    await createSheet.getByText("请求限流", { exact: true }).count() === 1 &&
    await createSheet.getByText("有效期", { exact: true }).count() === 1);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    check("创建表单焦点仍在 Sheet 内 " + (i + 1), await page.evaluate(() => {
      const panel = document.querySelector(".mac-sheet-panel");
      return Boolean(panel && panel.contains(document.activeElement));
    }));
  }
  await page.keyboard.press("Escape");
  await createSheet.waitFor({ state: "detached" });

  const firstRow = rows.filter({ hasText: "测试密钥 1" });
  await firstRow.getByRole("button", { name: "编辑 测试密钥 1", exact: true }).click();
  const editSheet = win.getByRole("dialog", { name: "编辑密钥 · 测试密钥 1", exact: true });
  await editSheet.waitFor();
  check("编辑表单显示 IP、限流、到期配置入口",
    await editSheet.getByText("IP 访问控制", { exact: true }).count() === 1 &&
    await editSheet.getByText("请求限流", { exact: true }).count() === 1 &&
    await editSheet.getByText("有效期", { exact: true }).count() === 1);
  const editChecks = editSheet.locator('input[type="checkbox"]');
  await editChecks.nth(2).check();
  await editChecks.nth(3).check();
  check("编辑表单可展开限流与到期字段",
    await editSheet.locator('input[type="datetime-local"]').count() === 1 &&
    await editSheet.getByText("5 小时", { exact: true }).count() === 1);
  await page.keyboard.press("Escape");
  await editSheet.waitFor({ state: "detached" });

  const derivedRow = rows.filter({ hasText: "测试密钥 3" });
  await derivedRow.getByRole("button", { name: "编辑 测试密钥 3", exact: true }).click();
  const derivedEdit = win.getByRole("dialog", { name: "编辑密钥 · 测试密钥 3", exact: true });
  await derivedEdit.waitFor();
  check("额度耗尽状态不可手动切换", await derivedEdit.locator("select").nth(1).isDisabled());
  await page.keyboard.press("Escape");
  await derivedEdit.waitFor({ state: "detached" });

  await firstRow.getByRole("button", { name: "删除 测试密钥 1", exact: true }).click();
  const alert = win.getByRole("alertdialog");
  await alert.waitFor();
  check("删除先要求确认", mutationRequests.length === 0);
  await alert.getByRole("button", { name: "取消", exact: true }).click();
  await alert.waitFor({ state: "detached" });
  check("取消删除不发送 DELETE", mutationRequests.length === 0);

  failKeys = true;
  await win.getByRole("button", { name: "刷新密钥列表", exact: true }).click();
  await win.getByText("密钥列表加载失败，请检查连接后重试。", { exact: true }).waitFor();
  check("列表 503 保留已有行", await rows.count() === 123 && await win.getByText("长密钥 123", { exact: true }).count() === 1);

  failKeys = false;
  failGroups = true;
  failSettings = true;
  failUsage = true;
  await win.getByRole("button", { name: "刷新密钥列表", exact: true }).click();
  await win.getByText(/分组、消费统计、接入地址暂时无法加载/).waitFor();
  check("辅助接口失败只显示警告并保留列表", await rows.count() === 123);

  failGroups = false;
  failSettings = false;
  failUsage = false;
  await win.getByRole("button", { name: "刷新密钥列表", exact: true }).click();
  await win.getByText("123 个密钥", { exact: true }).waitFor();

  await page.screenshot({ path: "output/playwright/n02/keychain-light.png", animations: "disabled" });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance("dark"));
  await page.waitForTimeout(120);
  await page.screenshot({ path: "output/playwright/n02/keychain-dark.png", animations: "disabled" });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance("light"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobile = await page.evaluate(() => {
    const visibleWindow = [...document.querySelectorAll(".window")].find(element => {
      const style = getComputedStyle(element);
      return style.display !== "none" && element.getBoundingClientRect().width > 0;
    });
    const rect = visibleWindow?.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      windowLeft: rect?.left ?? null,
      windowRight: rect?.right ?? null,
    };
  });
  const createButtonBox = await win.getByRole("button", { name: "创建 API 密钥", exact: true }).boundingBox();
  check("390px 窄屏无页面横向溢出且主操作可达",
    mobile.documentWidth <= mobile.viewportWidth + 1 &&
    mobile.windowLeft !== null && mobile.windowLeft >= -1 && mobile.windowRight <= mobile.viewportWidth + 1 &&
    Boolean(createButtonBox), mobile);
  await page.screenshot({ path: "output/playwright/n02/keychain-mobile.png", animations: "disabled" });

  check("没有未预期的页面异常", pageErrors.length === 0, { pageErrors });
  check("创建/更新/删除写请求均未越过夹具", mutationRequests.length === 0, { mutationRequests });
  return {
    passed: true,
    checks: results,
    pageErrors,
    keyPageRequests,
    mutationRequests,
    screenshots: [
      "output/playwright/n02/keychain-light.png",
      "output/playwright/n02/keychain-dark.png",
      "output/playwright/n02/keychain-mobile.png",
    ],
    fixtureOnly: true,
    note: "所有业务接口均由浏览器路由夹具响应；这不是原版后端读写验收。",
  };
}
