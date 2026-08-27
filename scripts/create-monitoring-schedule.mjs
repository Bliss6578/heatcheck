/** Create or update a QStash schedule that invokes due HeatCheck analyses every 15 minutes. */
const required = ["QSTASH_TOKEN", "HEATCHECK_APP_URL", "CRON_SECRET"];
const missing = required.filter(key => !process.env[key]);
if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Keep these in your shell or CI, never source control.`);

const endpoint = `${process.env.HEATCHECK_APP_URL.replace(/\/$/, "")}/api/cron/heatcheck-monitoring`;
const response = await fetch("https://qstash.upstash.io/v2/schedules", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ destination: endpoint, cron: "*/15 * * * *", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }),
});
if (!response.ok) throw new Error(`QStash schedule creation failed (${response.status}): ${await response.text()}`);
console.log("HeatCheck 15-minute scheduler created:", await response.text());
