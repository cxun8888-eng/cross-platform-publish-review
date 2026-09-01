(() => {
  const base = document.querySelector<HTMLInputElement>("#app-base-url");
  const path = document.querySelector<HTMLInputElement>("#callback-path");
  const status = document.querySelector<HTMLElement>("#status");
  const send = <T>(message: Record<string, unknown>) => chrome.runtime.sendMessage(message) as Promise<{ ok: boolean; data?: T; error?: string }>;
  const show = (text: string, error = false) => { if (status) { status.textContent = text; status.classList.toggle("error", error); } };
  void send<{ appBaseUrl: string; callbackPath: string }>({ type: "GET_APP_CONFIG" }).then((result) => {
    if (!result.ok || !result.data) throw new Error(result.error || "读取设置失败");
    if (base) base.value = result.data.appBaseUrl;
    if (path) path.value = result.data.callbackPath;
  }).catch((error) => show(error instanceof Error ? error.message : "读取设置失败", true));
  document.querySelector("#save")?.addEventListener("click", () => { void send({ type: "SET_APP_CONFIG", appBaseUrl: base?.value, callbackPath: path?.value }).then((result) => show(result.ok ? "设置已保存" : result.error || "保存失败", !result.ok)); });
  document.querySelector("#open-app")?.addEventListener("click", () => { void send<{ appBaseUrl: string; callbackPath: string }>({ type: "GET_APP_CONFIG" }).then(async (result) => { if (!result.ok || !result.data) throw new Error(result.error || "读取设置失败"); await chrome.tabs.create({ url: new URL(result.data.callbackPath, result.data.appBaseUrl).toString() }); }).catch((error) => show(error instanceof Error ? error.message : "打开失败", true)); });
})();
