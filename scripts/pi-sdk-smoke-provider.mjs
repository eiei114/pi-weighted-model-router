export default function registerSmokeProvider(pi) {
  pi.registerProvider("pi-sdk-smoke", {
    name: "Pi SDK offline smoke provider",
    baseUrl: "http://127.0.0.1:1",
    apiKey: "offline-smoke-key",
    api: "openai-completions",
    models: [
      {
        id: "router-model",
        name: "Router smoke model",
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 4096,
        maxTokens: 512,
      },
    ],
  });
  pi.on("input", (event) => {
    if (event.text !== "?router-diagnostics-smoke") return { action: "continue" };
    pi.sendUserMessage("/model-router:diagnostics", { expandPromptTemplates: true });
    return { action: "handled" };
  });
}
