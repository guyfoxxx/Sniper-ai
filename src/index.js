export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // ultra-light endpoints (no DB)
      if (url.pathname === "/health") return new Response("ok", { status: 200 });
      if (url.pathname === "/favicon.ico") return new Response("", { status: 204 });

      // load config from bot_db (cached)
      env.__cfg = await loadMainConfig(env);

      // ===== MINI APP (inline) =====
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
        return htmlResponse(MINI_APP_HTML);
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        const js = MINI_APP_JS
          .replace(/\\`/g, "`")
          .replace(/\\\$\{/g, "${");
        return jsResponse(js);
      }

      // ===== MINI APP APIs =====
      if (url.pathname === "/api/user" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);
        const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
        const symbols = [...MAJORS, ...METALS, ...INDICES, ...CRYPTOS];
        const marketSymbols = { forex: MAJORS, metals: METALS, indices: INDICES, crypto: CRYPTOS };

        const cfg = cfgOf(env);
        const styles = (cfg?.styles && Array.isArray(cfg.styles) && cfg.styles.length)
          ? cfg.styles.filter(s => s && s.enabled !== false).map(s => String(s.label || "").trim()).filter(Boolean)
          : Object.keys(STYLE_ANALYSIS_PROMPTS_DEFAULT || {});

        return jsonResponse({
          ok: true,
          welcome: WELCOME_MINIAPP,
          state: st,
          quota,
          symbols,
          marketSymbols,
          styles,
          isAdmin: isAdmin(v.fromLike, env) || isStaff(v.fromLike, env),
          walletAddress: (await getWallet(env)) || "",
          subPlans: getSubPlans(env),
        });
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);

        // users can tweak only their preferences (admin-only prompt/wallet enforced elsewhere)
        if (typeof body.timeframe === "string") st.timeframe = body.timeframe;
        if (typeof body.style === "string") st.style = normalizeStyleLabel(body.style);
        if (typeof body.risk === "string") st.risk = body.risk;
        if (typeof body.newsEnabled === "boolean") st.newsEnabled = body.newsEnabled;

        if (getDB(env)) await saveUser(v.userId, st, env);

        const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
        return jsonResponse({ ok: true, state: st, quota });
      }

      // Wallet APIs (credit balance; manual/admin managed)
      if (url.pathname === "/api/wallet/balance" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);
        return jsonResponse({
          ok: true,
          balance: Number(st.wallet?.balance || 0),
          currency: st.wallet?.currency || "USDT",
          points: Number(st.referral?.points || 0),
          subscription: st.subscription,
          walletAddress: (await getWallet(env)) || "",
          pendingSubTicket: st.subscription?.pendingTicket || "",
        });
      }

      if (url.pathname === "/api/wallet/withdraw" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);

        const amount = Number(body.amount);
        const address = String(body.address || "").trim();

        if (!Number.isFinite(amount) || amount <= 0) return jsonResponse({ ok: false, error: "withdraw_bad_amount" }, 400);
        if (!address) return jsonResponse({ ok: false, error: "withdraw_bad_address" }, 400);

        if (Number(st.wallet?.balance || 0) < amount) {
          return jsonResponse({ ok: false, error: "insufficient_funds" }, 400);
        }

        st.wallet.balance = Number(st.wallet.balance || 0) - amount;

        const ticket = await createWithdrawTicket(env, {
          userId: v.userId,
          amount,
          address,
          from: v.fromLike,
        });

        await saveUser(v.userId, st, env);

        return jsonResponse({
          ok: true,
          ticket,
          balance: Number(st.wallet.balance || 0),
          currency: st.wallet.currency || "USDT",
        });
      }

      
      // Subscription APIs (purchase request -> admin approve -> activate)
      if (url.pathname === "/api/subscription/plans" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        return jsonResponse({ ok: true, plans: getSubPlans(env) });
      }

      if (url.pathname === "/api/subscription/status" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);
        let req = null;
        if (st.subscription?.pendingTicket) req = await getSubRequest(env, st.subscription.pendingTicket);
        return jsonResponse({ ok: true, subscription: st.subscription, pending: req || null });
      }

      if (url.pathname === "/api/subscription/request" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        if (!getDB(env)) return jsonResponse({ ok: false, error: "kv_required" }, 500);

        const st = await ensureUser(v.userId, env, v.fromLike);
        if (!st.profile?.name || !st.profile?.phone) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

        if (st.subscription?.pendingTicket) {
          return jsonResponse({ ok: false, error: "sub_pending_exists", ticket: st.subscription.pendingTicket }, 409);
        }

        const plan = planFromLabel(env, body.planId);
        if (!plan) return jsonResponse({ ok: false, error: "bad_plan" }, 400);

        const payMethod = String(body.payMethod || "").trim(); // balance | txid
        const txid = String(body.txid || "").trim();

        const bal = Number(st.wallet?.balance || 0);
        let paidFromBalance = false;

        if (payMethod === "balance") {
          if (bal < plan.price) return jsonResponse({ ok: false, error: "insufficient_funds" }, 400);
          st.wallet.balance = bal - plan.price;
          paidFromBalance = true;
        } else {
          if (!txid) return jsonResponse({ ok: false, error: "txid_required" }, 400);
        }

        const payload = {
          userId: String(v.userId),
          username: st.profile?.username || v.fromLike?.username || "",
          planId: plan.id,
          planTitle: plan.title,
          planDays: plan.days,
          dailyLimit: plan.dailyLimit,
          amount: plan.price,
          currency: plan.currency,
          payMethod: paidFromBalance ? "balance" : "txid",
          txid: paidFromBalance ? "" : txid,
          paidFromBalance,
        };

        const ticket = await createSubTicket(env, payload);

        st.subscription.pendingTicket = ticket;
        st.subscription.pendingPlanId = plan.id;
        st.subscription.pendingPayMethod = payload.payMethod;
        st.subscription.pendingAmount = plan.price;
        await saveUser(v.userId, st, env);

        await notifyAdminsSubRequest(env, { ...payload, ticket });

        return jsonResponse({ ok: true, ticket, balance: Number(st.wallet?.balance || 0), currency: st.wallet?.currency || "USDT" });
      }


      // ===== ADMIN APIs (MiniApp) =====
      if (url.pathname === "/api/admin/config/get" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);
        const cfg = await loadMainConfig(env);
        return jsonResponse({ ok: true, cfg });
      }

      if (url.pathname === "/api/admin/config/set" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);
        const db = getDB(env);
        if (!db) return jsonResponse({ ok: false, error: "bot_db_missing" }, 500);

        const current = await loadMainConfig(env);
        const patch = body.patch || {};

        const next = JSON.parse(JSON.stringify(current));

        if (typeof patch.walletAddress === "string") next.walletAddress = patch.walletAddress.trim();

        if (patch.limits && typeof patch.limits === "object") {
          if (patch.limits.freeDailyLimit != null) next.limits.freeDailyLimit = toInt(patch.limits.freeDailyLimit, next.limits.freeDailyLimit);
          if (patch.limits.premiumDailyLimit != null) next.limits.premiumDailyLimit = toInt(patch.limits.premiumDailyLimit, next.limits.premiumDailyLimit);
        }

        if (patch.commissions && typeof patch.commissions === "object") {
          if (patch.commissions.globalPct != null) next.commissions.globalPct = Number(patch.commissions.globalPct);
          if (patch.commissions.perUser && typeof patch.commissions.perUser === "object") {
            const per = {};
            for (const [k, v2] of Object.entries(patch.commissions.perUser)) {
              const nk = normHandle(k);
              const pv = Number(v2);
              if (!nk || !Number.isFinite(pv)) continue;
              per[nk] = pv;
            }
            next.commissions.perUser = { ...(next.commissions.perUser || {}), ...per };
          }
        }

        if (Array.isArray(patch.subPlans)) {
          next.subPlans = patch.subPlans
            .map(p => ({
              id: String(p.id || "").trim(),
              title: String(p.title || "").trim(),
              days: toInt(p.days, 0),
              price: Number(p.price),
              currency: String(p.currency || current.subPlans?.[0]?.currency || "USDT").trim() || "USDT",
              dailyLimit: toInt(p.dailyLimit, next.limits.premiumDailyLimit),
            }))
            .filter(p => p.id && p.title && p.days > 0 && Number.isFinite(p.price));
        }

        if (Array.isArray(patch.styles)) {
          next.styles = patch.styles.map(s => ({
            id: String(s.id || stylePromptKey(s.label) || s.label || "").trim() || randomCode(8),
            label: normalizeStyleLabel(s.label || ""),
            enabled: s.enabled !== false,
            prompt: String(s.prompt || "").trim(),
          })).filter(s => s.label);
        }

        const saved = await saveMainConfig(env, next);
        return jsonResponse({ ok: true, cfg: saved });
      }

      if (url.pathname === "/api/admin/users/list" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const db = getDB(env);
        if (!db || typeof db.list !== "function") return jsonResponse({ ok: false, error: "list_not_supported" }, 500);

        const limit = Math.min(50, Math.max(1, toInt(body.limit, 20)));
        const cursor = body.cursor ? String(body.cursor) : undefined;

        const res = await db.list({ prefix: "u:", limit, cursor });
        const keys = res?.keys || [];
        const users = [];

        for (const k of keys) {
          const raw = await db.get(k.name);
          if (!raw) continue;
          try {
            const u = JSON.parse(raw);
            users.push({
              userId: u.userId,
              name: u?.profile?.name || "",
              username: u?.profile?.username || "",
              phone: u?.profile?.phone || "",
              dailyUsed: u.dailyUsed || 0,
              dailyLimit: dailyLimit(env, u),
              points: u?.referral?.points || 0,
              invites: u?.referral?.successfulInvites || 0,
              subscription: u?.subscription || {},
              wallet: u?.wallet || {},
            });
          } catch {}
        }

        return jsonResponse({ ok: true, users, cursor: res?.cursor || null, listComplete: Boolean(res?.list_complete) });
      }

      if (url.pathname === "/api/admin/sub/pending" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const db = getDB(env);
        if (!db || typeof db.list !== "function") return jsonResponse({ ok: false, error: "list_not_supported" }, 500);

        const res = await db.list({ prefix: "subreq:", limit: 50 });
        const keys = res?.keys || [];
        const items = [];
        for (const k of keys) {
          const ticket = String(k.name || "").replace("subreq:", "");
          const req = await getSubRequest(env, ticket);
          if (req && req.status === "pending") items.push(req);
        }
        // newest first
        items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        return jsonResponse({ ok: true, items });
      }

      if (url.pathname === "/api/admin/sub/approve" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const ticket = String(body.ticket || "").trim();
        if (!ticket) return jsonResponse({ ok: false, error: "bad_ticket" }, 400);

        const r = await adminApproveSub(env, ticket, v.fromLike);
        if (!r.ok) return jsonResponse({ ok: false, error: r.error || "failed" }, 400);
        return jsonResponse({ ok: true, ...r });
      }

      if (url.pathname === "/api/admin/sub/reject" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const ticket = String(body.ticket || "").trim();
        if (!ticket) return jsonResponse({ ok: false, error: "bad_ticket" }, 400);
        const reason = String(body.reason || "رد شد").trim();

        const r = await adminRejectSub(env, ticket, v.fromLike, reason);
        if (!r.ok) return jsonResponse({ ok: false, error: r.error || "failed" }, 400);
        return jsonResponse({ ok: true, ...r });
      }

      if (url.pathname === "/api/admin/withdraw/list" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);
        if (!(isAdmin(v.fromLike, env) || isStaff(v.fromLike, env))) return jsonResponse({ ok: false, error: "forbidden" }, 403);

        const db = getDB(env);
        if (!db || typeof db.list !== "function") return jsonResponse({ ok: false, error: "list_not_supported" }, 500);

        const res = await db.list({ prefix: "wd:", limit: 50 });
        const keys = res?.keys || [];
        const items = [];
        for (const k of keys) {
          const raw = await db.get(k.name);
          if (!raw) continue;
          try { items.push(JSON.parse(raw)); } catch {}
        }
        items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
        return jsonResponse({ ok: true, items });
      }
if (url.pathname === "/api/analyze" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env, v.fromLike);
        const symbol = String(body.symbol || "").trim();
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        // must complete onboarding before using AI analysis (name+contact at least)
        if (!st.profile?.name || !st.profile?.phone) {
          return jsonResponse({ ok: false, error: "onboarding_required" }, 403);
        }

        if (getDB(env) && !canAnalyzeToday(st, v.fromLike, env)) {
          const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
          return jsonR