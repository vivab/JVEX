// A single real request to Groq, executed in GitHub Actions with a repository secret.
// No API key is printed, bundled, deployed to Pages, or returned to the web browser.
const key = process.env.GROQ_API_KEY;
if (!key) {
  console.error("FAIL: GROQ_API_KEY repository secret was not provided.");
  process.exit(1);
}
const model = "openai/gpt-oss-120b";
const prompt = String(process.env.JVEX_TEST_PROMPT || "").trim().slice(0, 1000) ||
  "Привет! Представься одним предложением для проверки подключения.";
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 40000);
try {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
    },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      reasoning_effort: "low",
      max_completion_tokens: 600,
      stream: false,
      messages: [
        { role: "system", content: "Ты JVEX, дружелюбный и краткий русскоязычный ИИ-помощник. Ответь одним предложением." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(data?.error?.message || "provider rejected request")
      .replaceAll(key, "[redacted]").slice(0, 180);
    console.error("Groq test failed, HTTP " + response.status + ": " + message);
    process.exitCode = 1;
  } else {
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      console.error("Groq responded, but returned empty text.");
      process.exitCode = 1;
    } else {
      console.log("JVEX → Groq: connection verified");
      console.log("Model: " + (data.model || model));
      console.log("Test response: " + answer.trim().replaceAll(key, "[redacted]").slice(0, 400));
      console.log("The public website still needs a server-side API gateway to use this key.");
    }
  }
} catch (err) {
  console.error("Groq connectivity test failed: " + String(err.name || "NetworkError"));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
