async (page) => {
  const origin = "http://127.0.0.1:5181";
  const results = [];
  const pageErrors = [];
  const keyPageRequests = [];
  const usageRequests = [];
  const exportRequests = [];
  const errorRequests = [];
  const detailRequests = [];
  const mutationRequests = [];

  let failUsage = false;
  let failGroups = false;
  let failErrors = false;
  let failDetail = false;
  let truncateExport = false;

  const groups = [
    { id: 1, name: "默认分组", rate_multiplier: 1 },
    { id: 2, name: "开发分组", rate_multiplier: 2 },
  ];
  const allKeys = Array.from({ length: 123 }, (_, index) => ({
    id: index + 1,
    user_id: 99,
    name: "活动密钥 " + (index + 1),
    key: "sk-fixture-" + String(index + 1).padStart(3, "0"),
    group_id: index % 2 === 0 ? 1 : 2,
    group: groups[index % 2],
  }));
  const models = ["测试模型 1", "测试模型 2", "测试模型 3"];
  const makeUsageLog = (index) => {
    const apiKey = allKeys[index % allKeys.length];
    const group = groups[index % groups.length];
    return {
      id: index + 1,
      user_id: 99,
      api_key_id: apiKey.id,
      account_id: null,
      request_id: "fixture-request-" + (index + 1),
      model: models[index % models.length],
      reasoning_effort: index % 2 ? "medium" : null,
      inbound_endpoint: "/v1/chat/completions",
      upstream_endpoint: "https://upstream.fixture.invalid/v1/chat/completions",
      group_id: group.id,
      subscription_id: null,
      input_tokens: 100 + index,
      output_tokens: 50 + index,
      cache_creation_tokens: 0,
      cache_read_tokens: index % 3 === 0 ? 20 : 0,
      cache_creation_5m_tokens: 0,
      cache_creation_1h_tokens: 0,
      input_cost: 0.001,
      output_cost: 0.002,
      cache_creation_cost: 0,
      cache_read_cost: 0,
      total_cost: 0.003,
      actual_cost: 0.0025,
      rate_multiplier: group.rate_multiplier,
      long_context_billing_applied: false,
      billing_type: 0,
      request_type: index % 4 === 0 ? "stream" : "sync",
      stream: index % 4 === 0,
      native_compaction_v2: false,
      duration_ms: 120 + index,
      first_token_ms: 40,
      image_count: 0,
      image_size: null,
      image_input_size: null,
      image_output_size: null,
      image_size_source: null,
      image_size_breakdown: null,
      image_input_tokens: 0,
      image_input_cost: 0,
      image_output_tokens: 0,
      image_output_cost: 0,
      user_agent: "N03 fixture",
      ip_address: "192.0.2." + ((index % 200) + 1),
      cache_ttl_overridden: false,
      billing_mode: "token",
      created_at: "2026-09-10T08:" + String(index % 60).padStart(2, "0") + ":00Z",
      api_key: apiKey,
      group,
    };
  };
  const usageLogs = Array.from({ length: 205 }, (_, index) => makeUsageLog(index));
  const errorRows = Array.from({ length: 45 }, (_, index) => ({
    id: index + 1,
    created_at: "2026-09-10T07:" + String(index % 60).padStart(2, "0") + ":00Z",
    model: models[index % models.length],
    inbound_endpoint: "/v1/chat/completions",
    status_code: index % 2 ? 429 : 401,
    category: index % 2 ? "rate_limit" : "auth",
    platform: "openai",
    message: "fixture error " + (index + 1),
    key_name: "活动密钥 " + ((index % allKeys.length) + 1),
    key_deleted: false,
    client_ip: "198.51.100." + ((index % 200) + 1),
    group_name: groups[index % groups.length].name,
    request_type: 0,
    stream: false,
    user_agent: "N03 fixture",
  }));

  const check = (name, condition, details = {}) => {
    if (!condition) throw new Error(name + ": " + JSON.stringify(details));
    results.push({ name, passed: true, ...details });
  };

  const fulfill = (route, data, status = 200, message = "N03 夹具请求失败") => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status >= 400 ? { code: status, message } : { code: 0, data }),
  });

  const getNumber = (url, key, fallback) => Number(url.match(new RegExp("[?&]" + key + "=(\\d+)"))?.[1] || fallback);

  await page.unrouteAll({ behavior: "wait" });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async value => { window.__fixtureCopiedText = value; } },
    });
    localStorage.setItem("auth_token", "n03-fixture-token");
  });

  await page.route(origin + "/health", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "ok" }),
  }));

  await page.route(origin + "/api/**", async route => {
    const request = route.request();
    const requestUrl = request.url();
    const path = requestUrl.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const method = request.method();

    if (method !== "GET") {
      mutationRequests.push({ method, path });
      return fulfill(route, null, 403, "N03 夹具禁止写请求");
    }
    if (path.endsWith("/auth/me")) {
      return fulfill(route, { id: 99, username: "N03 夹具用户", email: "n03@example.invalid", role: "user", status: "active", balance: 12, concurrency: 5 });
    }
    if (path.endsWith("/admin/compliance/status")) return fulfill(route, { required: false });
    if (path.endsWith("/settings/public")) return fulfill(route, { api_base_url: "https://api.fixture.invalid/v1" });
    if (path.endsWith("/groups/available")) {
      if (failGroups) return fulfill(route, null, 503, "分组夹具失败");
      return fulfill(route, groups);
    }
    if (path.endsWith("/keys")) {
      const pageNumber = getNumber(requestUrl, "page", 1);
      const pageSize = getNumber(requestUrl, "page_size", 100);
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
    if (path === "/api/v1/usage") {
      if (failUsage) return fulfill(route, null, 503, "用量夹具失败");
      const pageNumber = getNumber(requestUrl, "page", 1);
      const pageSize = getNumber(requestUrl, "page_size", 20);
      const isExport = pageSize === 100;
      const entry = { page: pageNumber, pageSize, url: requestUrl };
      if (isExport) exportRequests.push(entry);
      else usageRequests.push(entry);
      const start = (pageNumber - 1) * pageSize;
      let items = usageLogs.slice(start, start + pageSize);
      if (isExport && truncateExport && pageNumber === 3) items = items.slice(0, 4);
      return fulfill(route, {
        items,
        total: usageLogs.length,
        page: pageNumber,
        page_size: pageSize,
        pages: Math.ceil(usageLogs.length / pageSize),
      });
    }
    if (path === "/api/v1/usage/stats") {
      return fulfill(route, {
        period: "custom",
        total_requests: usageLogs.length,
        total_input_tokens: 30000,
        total_output_tokens: 15000,
        total_cache_tokens: 2000,
        total_cache_read_tokens: 2000,
        total_cache_creation_tokens: 0,
        total_tokens: 47000,
        total_cost: 0.5,
        total_actual_cost: 0.42,
        average_duration_ms: 160,
        endpoints: [{ endpoint: "/v1/chat/completions", requests: usageLogs.length, total_tokens: 47000, cost: 0.5, actual_cost: 0.42 }],
      });
    }
    if (path === "/api/v1/usage/dashboard/models") {
      return fulfill(route, { models: models.map((model, index) => ({ model, requests: 50, input_tokens: 1000, output_tokens: 500, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 1500, cost: 0.1, actual_cost: 0.08 + index * 0.01 })) });
    }
    if (path === "/api/v1/usage/dashboard/snapshot-v2") {
      return fulfill(route, {
        generated_at: "2026-09-10T08:00:00Z",
        start_date: "2026-09-09",
        end_date: "2026-09-10",
        granularity: "hour",
        trend: [{ date: "2026-09-10", requests: 205, input_tokens: 30000, output_tokens: 15000, cache_creation_tokens: 0, cache_read_tokens: 2000, total_tokens: 47000, cost: 0.5, actual_cost: 0.42 }],
        groups: groups.map(group => ({ group_id: group.id, group_name: group.name, requests: 100, total_tokens: 20000, cost: 0.2, actual_cost: 0.17 })),
      });
    }
    if (path === "/api/v1/usage/dashboard/stats") {
      return fulfill(route, { today_requests: 205, today_tokens: 47000, today_actual_cost: 0.42 });
    }
    if (path === "/api/v1/usage/errors") {
      if (failErrors) return fulfill(route, null, 503, "错误列表夹具失败");
      const pageNumber = getNumber(requestUrl, "page", 1);
      const pageSize = getNumber(requestUrl, "page_size", 20);
      errorRequests.push({ page: pageNumber, pageSize, url: requestUrl });
      const start = (pageNumber - 1) * pageSize;
      return fulfill(route, {
        items: errorRows.slice(start, start + pageSize),
        total: errorRows.length,
        page: pageNumber,
        page_size: pageSize,
        pages: Math.ceil(errorRows.length / pageSize),
      });
    }
    if (/\/api\/v1\/usage\/errors\/\d+$/.test(path)) {
      detailRequests.push(path);
      if (failDetail) return fulfill(route, null, 503, "错误详情夹具失败");
      const id = Number(path.split("/").pop());
      const row = errorRows.find(item => item.id === id) || errorRows[0];
      return fulfill(route, { ...row, error_body: "fixture upstream response", upstream_status_code: row.status_code });
    }
    return fulfill(route, {});
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + "/?noboot&unlocked");
  await page.waitForFunction(() => Boolean(window.__macOS?.wm));
  await page.evaluate(() => {
    for (const win of [...window.__macOS.wm.windows.value]) window.__macOS.wm.closeWindow(win.id);
    window.__macOS.systemStore.setAppearance("light");
    window.__macOS.wm.openApp("activity");
  });

  const win = page.getByRole("region", { name: "使用记录", exact: true });
  await win.waitFor();
  const usageRows = win.locator('tbody tr[role="button"]');
  await usageRows.first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(250);
  check("使用记录首屏加载", await usageRows.count() === 20 && usageRequests.some(item => item.page === 1 && item.pageSize === 20));
  check("筛选密钥分页不静默截断", keyPageRequests.includes(1) && keyPageRequests.includes(2), { requestedPages: keyPageRequests });
  check("统计与默认趋势可见", await win.getByText("总请求数", { exact: true }).count() === 1 && await win.getByText("Token 使用趋势", { exact: true }).count() === 1);
  await win.getByRole('button', { name: '模型', exact: true }).click();
  await win.getByText('模型分布', { exact: true }).waitFor();
  check('模型分析可按需切换', await win.getByText('Token 使用趋势', { exact: true }).count() === 0);
  await win.getByRole('button', { name: '全部', exact: true }).click();
  check('全部分析保留', await win.getByText('Token 使用趋势', { exact: true }).count() === 1 && await win.getByText('模型分布', { exact: true }).count() === 1);

  const apiKeyFilter = win.getByRole("combobox", { name: "按 API 密钥筛选", exact: true });
  await apiKeyFilter.selectOption("2");
  await page.waitForTimeout(120);
  check("API 密钥筛选发出参数", usageRequests.some(item => item.url.includes("api_key_id=2")));
  await win.getByRole("button", { name: "重置", exact: true }).click();
  await page.waitForTimeout(120);
  await win.getByRole("button", { name: "近 7 天", exact: true }).click();
  await page.waitForTimeout(120);
  check("日期预设触发日期范围请求", usageRequests.some(item => item.url.includes("start_date=") && item.url.includes("end_date=")));
  await win.getByRole("button", { name: "重置", exact: true }).click();
  await page.waitForTimeout(120);

  await win.getByRole("button", { name: "下一页", exact: true }).click();
  await usageRows.first().waitFor();
  check("使用记录服务端分页", usageRequests.some(item => item.page === 2 && item.pageSize === 20) && (await usageRows.first().innerText()).includes("测试模型"));
  await usageRows.first().focus();
  await page.keyboard.press("Enter");
  const usageSheet = win.getByRole("dialog", { name: "使用记录详情", exact: true });
  await usageSheet.waitFor();
  check("表格行支持键盘打开详情", await usageSheet.getByText("路由与端点信息", { exact: true }).count() === 1);
  await page.keyboard.press("Escape");
  await usageSheet.waitFor({ state: "detached" });

  await win.getByRole("button", { name: "重置", exact: true }).click();
  await page.waitForTimeout(120);
  exportRequests.length = 0;
  await win.getByRole("button", { name: "导出使用记录 CSV", exact: true }).click();
  await page.waitForTimeout(250);
  check("CSV 导出完整分页", exportRequests.map(item => item.page).join(",") === "1,2,3", { exportPages: exportRequests.map(item => item.page) });

  truncateExport = true;
  exportRequests.length = 0;
  await win.getByRole("button", { name: "导出使用记录 CSV", exact: true }).click();
  await win.getByText(/导出数据不完整/, { exact: false }).waitFor({ timeout: 20000 });
  check("CSV 不完整时显示错误并保留入口", await win.locator('.activity-export-status[role="alert"]').count() === 1);
  truncateExport = false;
  await win.locator('.activity-export-status[role="alert"]').getByRole("button", { name: "重试", exact: true }).click();
  await page.waitForTimeout(250);
  check("CSV 导出错误可重试", exportRequests.slice(-3).map(item => item.page).join(",") === "1,2,3", { retryPages: exportRequests.map(item => item.page) });

  failUsage = true;
  await win.getByRole("button", { name: "刷新使用记录", exact: true }).click();
  await win.getByText("用量明细加载失败。", { exact: true }).waitFor({ timeout: 20000 });
  check("用量 503 保留已有记录", await usageRows.count() === 20 && await win.getByText("测试模型", { exact: false }).count() > 0);
  failUsage = false;

  failGroups = true;
  await win.getByRole("button", { name: "刷新使用记录", exact: true }).click();
  await win.getByText(/分组筛选暂时无法加载/, { exact: false }).waitFor({ timeout: 20000 });
  check("辅助筛选失败不误报列表失败", await usageRows.count() === 20);
  failGroups = false;

  await win.getByRole("button", { name: "错误请求", exact: true }).click();
  const errorRowsLocator = win.locator('tbody tr[role="button"]');
  await errorRowsLocator.first().waitFor({ timeout: 20000 });
  check("错误请求列表可加载", await errorRowsLocator.count() === 20 && errorRequests.some(item => item.page === 1));
  await win.getByRole("combobox", { name: "错误请求按分类筛选", exact: true }).selectOption("rate_limit");
  await page.waitForTimeout(120);
  check("错误分类筛选发出参数", errorRequests.some(item => item.url.includes("category=rate_limit")));
  await errorRowsLocator.first().click();
  const errorSheet = win.getByRole("dialog", { name: "错误请求详情", exact: true });
  await errorSheet.waitFor();
  check("错误请求详情可打开", await errorSheet.getByText("fixture upstream response", { exact: true }).count() === 1);
  await page.keyboard.press("Escape");
  await errorSheet.waitFor({ state: "detached" });

  failDetail = true;
  await errorRowsLocator.first().click();
  await errorSheet.waitFor();
  await errorSheet.getByText("错误详情加载失败，请重试。", { exact: true }).waitFor();
  failDetail = false;
  await errorSheet.getByRole("button", { name: "重试", exact: true }).click();
  await errorSheet.getByText("fixture upstream response", { exact: true }).waitFor();
  check("错误详情失败可重试", detailRequests.length >= 3);
  await page.keyboard.press("Escape");
  await errorSheet.waitFor({ state: "detached" });

  failErrors = true;
  await win.getByRole("button", { name: "刷新使用记录", exact: true }).click();
  await win.getByText("错误请求列表加载失败。", { exact: true }).waitFor({ timeout: 20000 });
  check("错误列表 503 保留已有行", await errorRowsLocator.count() === 20);
  failErrors = false;

  await page.screenshot({ animations: "disabled", path: "output/playwright/n03/activity-light.png" });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance("dark"));
  await page.screenshot({ animations: "disabled", path: "output/playwright/n03/activity-dark.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(180);
  const compact = await win.locator(".activity-app").evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: innerWidth,
    bodyScrollWidth: document.documentElement.scrollWidth,
    primaryActionVisible: Boolean(element.querySelector('[aria-label="刷新使用记录"]')),
  }));
  check("390px 视口无横向溢出且主要操作仍在 DOM", compact.scrollWidth <= compact.clientWidth + 1 && compact.bodyScrollWidth <= compact.viewportWidth + 1 && compact.primaryActionVisible, compact);
  await page.screenshot({ animations: "disabled", path: "output/playwright/n03/activity-mobile.png" });

  check("未产生真实写请求", mutationRequests.length === 0, { mutationRequests });
  check("浏览器无页面异常", pageErrors.length === 0, { pageErrors });
  return {
    passed: true,
    results,
    realBackendRequests: 0,
    detailRequests,
    note: "N03 业务请求全部由浏览器夹具拦截；这证明前端契约与交互，不等于真实原版后端验收。",
  };
}
