const ENDPOINT = "https://api.ziprecruiter.com/mcp";
let requestId = 1;

async function rpc(method, params, sessionId, protocolVersion) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  if (protocolVersion) headers["MCP-Protocol-Version"] = protocolVersion;
  const response = await fetch(ENDPOINT, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`ZipRecruiter job search returned HTTP ${response.status}.`);
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  let messages;
  if (type.includes("text/event-stream")) {
    messages = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => {
      try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
    }).filter(Boolean);
  } else {
    try { messages = [JSON.parse(raw)]; } catch { throw new Error("ZipRecruiter returned an unreadable response."); }
  }
  const message = messages.find((item) => item.id === requestId - 1) || messages.at(-1);
  if (message?.error) throw new Error(message.error.message || "ZipRecruiter MCP request failed.");
  if (!message?.result) throw new Error("ZipRecruiter returned no job-search result.");
  return { result: message.result, sessionId: response.headers.get("mcp-session-id") || sessionId };
}

function toolArguments(schema, { query, location, remote, country, offset }) {
  const properties = schema?.properties || {};
  const args = {};
  const set = (aliases, value) => {
    if (value === undefined || value === "") return;
    const key = aliases.find((name) => Object.hasOwn(properties, name));
    if (key) args[key] = value;
  };
  set(["keywords", "query", "search_query", "search_terms"], query);
  set(["location", "city", "place"], location);
  set(["country", "country_code"], country);
  set(["remote", "remote_only", "is_remote"], remote || undefined);
  set(["offset", "page", "start", "start_index"], offset);
  set(["limit", "max_results", "count", "per_page"], 5);
  return args;
}

function asJobs(result) {
  if (result.structuredContent) return result.structuredContent;
  for (const part of result.content || []) {
    if (part.type !== "text") continue;
    try { return JSON.parse(part.text); } catch {}
  }
  return { message: (result.content || []).filter((part) => part.type === "text").map((part) => part.text).join("\n"), jobs: [] };
}

function trackFor(text) {
  const value = String(text || "").toLowerCase();
  if (/data engineer|analytics engineer|etl|warehouse/.test(value)) return "data_engineering";
  if (/machine learning|ml engineer|artificial intelligence|ai engineer|llm/.test(value)) return "machine_learning";
  if (/full.?stack|frontend|front-end|backend|back-end|web developer/.test(value)) return "full_stack";
  return "sde";
}

export async function searchZipRecruiter({ query, location = "", remote = false, country = "US", offset = 0 }) {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "PrepMaxxing", version: "1.0.0" },
  });
  const sessionId = initialized.sessionId;
  const protocolVersion = initialized.result.protocolVersion || "2025-03-26";
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  headers["MCP-Protocol-Version"] = protocolVersion;
  await fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: AbortSignal.timeout(8_000) });
  const listed = await rpc("tools/list", {}, sessionId, protocolVersion);
  const tool = (listed.result.tools || []).find((item) => item.name === "search_jobs");
  if (!tool) throw new Error("ZipRecruiter did not advertise its read-only search_jobs tool.");
  const arguments_ = toolArguments(tool.inputSchema, { query, location, remote, country, offset });
  const called = await rpc("tools/call", { name: tool.name, arguments: arguments_ }, listed.sessionId, protocolVersion);
  if (called.result.isError) throw new Error((called.result.content || []).map((item) => item.text || "").join(" ") || "ZipRecruiter search failed.");
  const payload = asJobs(called.result);
  const rawJobs = Array.isArray(payload) ? payload : payload.jobs || payload.results || payload.listings || payload.data?.jobs || [];
  const jobs = rawJobs.map((job, index) => {
    const title = String(job.title || job.job_title || "Role listing").slice(0, 220);
    const company = String(job.company || job.company_name || job.employer_name || "Employer not listed").slice(0, 180);
    const url = String(job.job_url || job.url || job.apply_url || job.link || job.job_link || "");
    const description = String(job.description || job.job_description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
    const skills = [...new Set(`${title} ${description}`.match(/\b(?:python|sql|java|javascript|typescript|react|node\.js|aws|azure|gcp|spark|pyspark|kafka|airflow|pytorch|tensorflow|machine learning|deep learning|docker|kubernetes|postgresql|data engineering|system design|rest api|git)\b/gi) || [])];
    return {
      id: String(job.id || job.job_id || url || `zip-${offset}-${index}`), title,
      track: trackFor(`${title} ${description}`), level: String(job.seniority || job.experience_level || "Not specified"),
      skills, jd_text: description || `${title} at ${company}`, company,
      location: String(job.location || [job.city, job.state, job.country].filter(Boolean).join(", ") || "Location not listed"),
      salary: String(job.salary || job.pay || job.compensation || "Not listed"), posted_at: job.posted_at || job.date_posted || null,
      url, source: "ZipRecruiter live listing",
    };
  }).filter((job) => job.url.startsWith("https://www.ziprecruiter.com/") || job.url.startsWith("https://ziprecruiter.com/"));
  return { jobs, source: "ZipRecruiter live listings", total: Number(payload.total || payload.total_results || jobs.length), nextOffset: jobs.length >= 5 ? offset + jobs.length : null, attribution: "Listings and application links are provided by ZipRecruiter; confirm details on the employer posting." };
}
