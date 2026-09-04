(function (global) {
    const SUPABASE_URL = 'https://sxbcjzshcjxzladwptiu.supabase.co';
    const PUBLISHABLE_KEY = 'sb_publishable_U5ZEfqHRxIJc1abrIzV0cg_keNdZvuK';
    const ENDPOINT = `${SUPABASE_URL}/functions/v1/alo-cozinha-sync`;
    const SESSION_KEY = 'alo_supabase_session_v1';
    const REFRESH_LOCK_KEY = 'alo_supabase_refresh_lock_v1';
    const REFRESH_BACKOFF_KEY = 'alo_supabase_refresh_backoff_v1';
    const DEVICE_KEY = 'alo_cloud_device_id_v1';
    const LOGIN_GUARD_KEY = 'alo_auth_login_guard_v1';
    const LOGIN_MAX_ATTEMPTS = 3;
    const LOGIN_LOCK_MS = 30 * 1000;
    const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
    const ACCOUNT_SITE = 'https://lincolnpontes.github.io/alo_cozinha2/auth-callback.html';
    let session = readSession();
    let channel = null;
    let initializing = null;
    let refreshPromise = null;
    let recoveryTimer = null;
    let recoveryAttempt = 0;
    let realtimeClient = null;
    let lastStatus = session ? 'connecting' : 'local';
    let accessMode = 'signin';
    let loginGuardTimer = null;
    let accessCaptchaToken = '';
    let turnstileWidgetId = null;
    let turnstileLoader = null;
    const refreshOwner = global.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let sessionInvalidated = false;

    function isDemoMode() {
        return global.AloDemo?.isActive?.() === true;
    }

    function isPublicTaskView() {
        const params = new URLSearchParams(global.location.search);
        return params.get('consulta') === 'tarefa';
    }

    function readSession() {
        try {
            const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            return value && value.access_token && value.refresh_token ? value : null;
        } catch (error) {
            return null;
        }
    }

    function saveSession(value) {
        if (!value?.access_token) return null;
        session = {
            access_token: value.access_token,
            refresh_token: value.refresh_token || session?.refresh_token || '',
            token_type: value.token_type || 'bearer',
            expires_at: value.expires_at || Math.floor(Date.now() / 1000) + Number(value.expires_in || 3600),
            user: value.user || session?.user || null
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        sessionInvalidated = false;
        renderAccountSettings();
        return session;
    }

    function wait(milliseconds) {
        return new Promise(resolve => global.setTimeout(resolve, milliseconds));
    }

    function readJsonStorage(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); }
        catch (error) { return null; }
    }

    function refreshBackoffUntil() {
        const value = readJsonStorage(REFRESH_BACKOFF_KEY);
        const until = Number(value?.until || 0);
        if (until <= Date.now()) {
            localStorage.removeItem(REFRESH_BACKOFF_KEY);
            return 0;
        }
        return until;
    }

    function registerRefreshBackoff(error) {
        const headerSeconds = Number.parseInt(String(error?.retryAfter || ''), 10);
        const delay = Number.isFinite(headerSeconds) && headerSeconds > 0
            ? headerSeconds * 1000
            : 30000;
        const until = Date.now() + Math.min(Math.max(delay, 5000), 5 * 60 * 1000);
        localStorage.setItem(REFRESH_BACKOFF_KEY, JSON.stringify({ until }));
        return until;
    }

    function acquireRefreshLock(refreshToken) {
        const now = Date.now();
        const current = readJsonStorage(REFRESH_LOCK_KEY);
        if (current?.owner && current.owner !== refreshOwner && Number(current.expiresAt || 0) > now) return false;
        const lock = { owner: refreshOwner, token: String(refreshToken || ''), expiresAt: now + 15000 };
        localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify(lock));
        return readJsonStorage(REFRESH_LOCK_KEY)?.owner === refreshOwner;
    }

    function releaseRefreshLock() {
        if (readJsonStorage(REFRESH_LOCK_KEY)?.owner === refreshOwner) localStorage.removeItem(REFRESH_LOCK_KEY);
    }

    async function adoptPeerSession(attemptedRefreshToken, timeout = 16000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const stored = readSession();
            if (stored?.refresh_token && stored.refresh_token !== attemptedRefreshToken) {
                saveSession(stored);
                updateRealtimeToken();
                return session;
            }
            const lock = readJsonStorage(REFRESH_LOCK_KEY);
            if (!lock?.owner || Number(lock.expiresAt || 0) <= Date.now()) return null;
            await wait(180);
        }
        return null;
    }

    function isTerminalRefreshError(error) {
        const code = String(error?.code || '').toLowerCase();
        const message = String(error?.message || '').toLowerCase();
        return ['refresh_token_not_found', 'refresh_token_already_used', 'invalid_grant'].includes(code)
            || /invalid refresh token|refresh token not found|refresh token already used/.test(message);
    }

    async function invalidateSession(message = 'Sua sessão expirou. Entre novamente para continuar sincronizando.') {
        const stored = readSession();
        if (stored?.refresh_token && session?.refresh_token && stored.refresh_token !== session.refresh_token) {
            saveSession(stored);
            updateRealtimeToken();
            return false;
        }
        sessionInvalidated = true;
        if (recoveryTimer) global.clearTimeout(recoveryTimer);
        recoveryTimer = null;
        recoveryAttempt = 0;
        if (channel && realtimeClient) await realtimeClient.removeChannel(channel).catch(() => {});
        channel = null;
        realtimeClient = null;
        session = null;
        localStorage.removeItem(SESSION_KEY);
        emitStatus('local', message);
        if (!isPublicTaskView()) showAccessScreen();
        global.dispatchEvent(new CustomEvent('alo:session-expired', { detail: { message } }));
        return true;
    }

    function deviceId() {
        let value = localStorage.getItem(DEVICE_KEY) || '';
        if (!value) {
            value = global.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            localStorage.setItem(DEVICE_KEY, value);
        }
        return value;
    }

    function emitStatus(status, message) {
        lastStatus = status;
        global.dispatchEvent(new CustomEvent('alo:cloud-status', { detail: { status, message: message || '' } }));
        renderAccountSettings(message);
    }

    function updateRealtimeToken() {
        if (session?.access_token && realtimeClient?.realtime?.setAuth) {
            realtimeClient.realtime.setAuth(session.access_token);
        }
    }

    function wakeAllModules() {
        ['kds', 'catalog', 'checklist', 'technical_sheets', 'documents', 'compras', 'etiquetas']
            .forEach(module => wakeModule(module));
    }

    function scheduleRecovery(delay = 5000) {
        if (recoveryTimer || !session || sessionInvalidated || isDemoMode() || !navigator.onLine) return;
        const authWait = Math.max(0, refreshBackoffUntil() - Date.now());
        const waitTime = Math.max(authWait, Math.min(60000, Math.max(delay, 5000) * Math.max(1, recoveryAttempt + 1)));
        recoveryTimer = global.setTimeout(async () => {
            recoveryTimer = null;
            const recovered = await initialize();
            if (!recovered) {
                recoveryAttempt = Math.min(recoveryAttempt + 1, 6);
                scheduleRecovery(5000);
            }
        }, waitTime);
    }

    function errorMessage(error) {
        const raw = String(error?.message || error || 'Falha inesperada.');
        const translations = [
            [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
            [/email not confirmed/i, 'Confirme o e-mail recebido antes de entrar.'],
            [/user already registered/i, 'Este e-mail já possui uma conta.'],
            [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
            [/unable to validate email/i, 'Digite um e-mail válido.'],
            [/too many requests|rate limit/i, 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'],
            [/failed to fetch|networkerror|load failed/i, 'Sem conexão com a nuvem. Seus dados locais continuam seguros.']
        ];
        return translations.find(([pattern]) => pattern.test(raw))?.[1] || raw;
    }

    async function parseResponse(response) {
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) { data = text; }
        if (!response.ok) {
            const error = new Error(data?.message || data?.msg || data?.error_description || data?.error || `Falha no servidor (${response.status}).`);
            error.status = response.status;
            error.retryAfter = response.headers.get('Retry-After') || '';
            error.code = data?.error_code || data?.code || '';
            error.payload = data;
            throw error;
        }
        return data;
    }

    async function refreshSession() {
        if (!session?.refresh_token) throw new Error('Conecte a conta da nuvem nas configurações.');
        if (sessionInvalidated) throw new Error('Sua sessão expirou. Entre novamente.');
        if (refreshPromise) return refreshPromise;
        const attemptedRefreshToken = session.refresh_token;
        refreshPromise = (async () => {
            const backoff = refreshBackoffUntil();
            if (backoff > Date.now()) {
                const error = new Error('A conexão está aguardando o prazo seguro para tentar novamente.');
                error.status = 429;
                error.retryAt = backoff;
                throw error;
            }
            if (!acquireRefreshLock(attemptedRefreshToken)) {
                const adopted = await adoptPeerSession(attemptedRefreshToken);
                if (adopted) return adopted;
                if (!acquireRefreshLock(attemptedRefreshToken)) {
                    const error = new Error('Outra aba está renovando a sessão.');
                    error.code = 'refresh_in_progress';
                    throw error;
                }
            }
            emitStatus('connecting', 'Renovando a conexão com a nuvem...');
            const response = await global.fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
                method: 'POST',
                headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: attemptedRefreshToken })
            });
            if (!response.ok) {
                const stored = readSession();
                if (stored?.refresh_token && stored.refresh_token !== attemptedRefreshToken) {
                    saveSession(stored);
                    updateRealtimeToken();
                    return session;
                }
            }
            const refreshed = saveSession(await parseResponse(response));
            localStorage.removeItem(REFRESH_BACKOFF_KEY);
            updateRealtimeToken();
            recoveryAttempt = 0;
            emitStatus('online', 'Conexão com a nuvem restabelecida');
            global.setTimeout(wakeAllModules, 0);
            return refreshed;
        })().catch(async error => {
            if (isTerminalRefreshError(error)) {
                const stored = readSession();
                if (stored?.refresh_token && stored.refresh_token !== attemptedRefreshToken) {
                    saveSession(stored);
                    updateRealtimeToken();
                    return session;
                }
                await invalidateSession();
            } else if (Number(error?.status || 0) === 429) {
                const until = error.retryAt || registerRefreshBackoff(error);
                emitStatus('warning', 'Aguardando para reconectar sem bloquear sua conta...');
                scheduleRecovery(Math.max(5000, until - Date.now()));
            } else {
                scheduleRecovery();
            }
            throw error;
        }).finally(() => {
            releaseRefreshLock();
            refreshPromise = null;
        });
        return refreshPromise;
    }

    async function ensureSession() {
        if (!session) throw new Error('Conecte a conta da nuvem nas configurações.');
        if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return session;
        return refreshSession();
    }

    async function cloudFetch(input, options = {}) {
        await ensureSession();
        const headers = new Headers(options.headers || {});
        headers.set('apikey', PUBLISHABLE_KEY);
        headers.set('Authorization', `Bearer ${session.access_token}`);
        headers.set('x-alo-device-id', deviceId());
        if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json;charset=utf-8');
        const request = () => global.fetch(input, { ...options, headers, mode: 'cors', cache: 'no-store' });
        let response;
        try {
            response = await request();
        } catch (error) {
            emitStatus('warning', 'Conexão interrompida; tentando restabelecer...');
            scheduleRecovery();
            throw error;
        }
        if (response.status === 401) {
            await refreshSession();
            if (!session) return response;
            headers.set('Authorization', `Bearer ${session.access_token}`);
            try {
                response = await request();
            } catch (error) {
                scheduleRecovery();
                throw error;
            }
            if (response.status === 401) {
                const error = new Error('A sessão não foi aceita pela nuvem.');
                error.code = 'invalid_grant';
                await invalidateSession();
            }
        }
        return response;
    }

    async function authRequest(path, body) {
        const response = await global.fetch(`${SUPABASE_URL}${path}`, {
            method: 'POST',
            headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        return parseResponse(response);
    }

    async function rpc(name, body = {}) {
        const response = await cloudFetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
            method: 'POST',
            headers: { 'Content-Profile': 'api', 'Accept-Profile': 'api' },
            body: JSON.stringify(body)
        });
        return parseResponse(response);
    }

    function wakeModule(module) {
        global.dispatchEvent(new CustomEvent('alo:cloud-change', { detail: { module } }));
        if (module === 'compras') global.AloFeiraModule?.syncNow?.().catch(() => {});
        if (module === 'etiquetas') global.AloEtiquetasCloud?.sync?.().catch(() => {});
        if (module === 'technical_sheets') global.AloTechnicalSheets?.syncNow?.().catch(() => {});
        if (module === 'documents') global.AloChecklistDocuments?.syncNow?.().catch(() => {});
        if (module === 'checklist') global.AloTasks?.syncAll?.().catch(() => {});
    }

    async function startRealtime() {
        if (!session?.user?.id || !global.supabase?.createClient) return;
        if (channel && realtimeClient) await realtimeClient.removeChannel(channel).catch(() => {});
        realtimeClient = global.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
            db: { schema: 'api' },
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            realtime: { params: { eventsPerSecond: 20 } }
        });
        realtimeClient.realtime.setAuth(session.access_token);
        channel = realtimeClient.channel(`alo-cozinha:${session.user.id}`)
            .on('postgres_changes', {
                event: '*', schema: 'api', table: 'module_states', filter: `owner_id=eq.${session.user.id}`
            }, payload => wakeModule(payload.new?.module || payload.old?.module || ''))
            .subscribe(status => {
                if (status === 'SUBSCRIBED') emitStatus('online', 'Sincronização instantânea ativa');
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') emitStatus('warning', 'Sincronização por conferência periódica');
            });
    }

    async function initialize() {
        if (initializing) return initializing;
        initializing = (async () => {
            renderAccountSettings();
            renderDemoState();
            if (isDemoMode()) {
                hideAccessScreen();
                emitStatus('local', 'Modo demonstração isolado da nuvem');
                return false;
            }
            if (!session) {
                emitStatus('local', 'Dados somente neste aparelho até conectar uma conta');
                if (!isPublicTaskView()) showAccessScreen();
                return false;
            }
            try {
                hideAccessScreen();
                await ensureSession();
                await rpc('bootstrap_account', { p_display_name: session.user?.user_metadata?.display_name || null });
                await startRealtime();
                recoveryAttempt = 0;
                if (recoveryTimer) global.clearTimeout(recoveryTimer);
                recoveryTimer = null;
                emitStatus('online', 'Conta conectada ao Supabase');
                global.dispatchEvent(new CustomEvent('alo:cloud-ready', { detail: { endpoint: ENDPOINT } }));
                return true;
            } catch (error) {
                emitStatus('error', errorMessage(error));
                if (!sessionInvalidated && session) scheduleRecovery();
                return false;
            }
        })().finally(() => { initializing = null; });
        return initializing;
    }

    function captchaSecurity(token) {
        return token ? { gotrue_meta_security: { captcha_token: token } } : {};
    }

    async function signIn(email, password, captchaToken = '') {
        sessionInvalidated = false;
        localStorage.removeItem(REFRESH_BACKOFF_KEY);
        const data = await authRequest('/auth/v1/token?grant_type=password', { email, password, ...captchaSecurity(captchaToken) });
        saveSession(data);
        await initialize();
        return data;
    }

    async function signUp(name, email, password, captchaToken = '') {
        const data = await authRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(ACCOUNT_SITE)}`, {
            email, password,
            data: { display_name: name || '' },
            ...captchaSecurity(captchaToken)
        });
        if (data?.session?.access_token) saveSession(data.session);
        else if (data?.access_token) saveSession(data);
        return data;
    }

    async function recover(email, captchaToken = '') {
        return authRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(ACCOUNT_SITE)}`, { email, ...captchaSecurity(captchaToken) });
    }

    async function signOut() {
        try {
            if (session) await cloudFetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST' });
        } catch (error) {}
        if (channel && realtimeClient) await realtimeClient.removeChannel(channel).catch(() => {});
        channel = null;
        realtimeClient = null;
        if (recoveryTimer) global.clearTimeout(recoveryTimer);
        recoveryTimer = null;
        recoveryAttempt = 0;
        sessionInvalidated = false;
        localStorage.removeItem(REFRESH_BACKOFF_KEY);
        releaseRefreshLock();
        session = null;
        localStorage.removeItem(SESSION_KEY);
        emitStatus('local', 'Conta desconectada; dados locais preservados');
        renderAccountSettings();
    }

    function getEndpoint() {
        return session && !isDemoMode() ? ENDPOINT : '';
    }

    function isEndpoint(url) {
        try {
            const candidate = new URL(String(url || ''), global.location?.href);
            const endpoint = new URL(ENDPOINT);
            return candidate.origin === endpoint.origin
                && candidate.pathname.replace(/\/$/, '') === endpoint.pathname.replace(/\/$/, '');
        } catch (error) {
            return false;
        }
    }

    function isConnected() {
        return !isDemoMode() && Boolean(session?.access_token && session?.refresh_token);
    }

    function setFeedback(message, error = false) {
        const element = document.getElementById('cloudAccountFeedback');
        if (!element) return;
        element.textContent = message || '';
        element.style.color = error ? '#b3261e' : '#0b6b57';
    }

    function renderAccountSettings(message) {
        const connected = document.getElementById('cloudAccountConnected');
        const disconnected = document.getElementById('cloudAccountDisconnected');
        const email = document.getElementById('cloudAccountEmail');
        const status = document.getElementById('cloudAccountStatus');
        if (!connected || !disconnected) return;
        connected.style.display = isConnected() ? 'block' : 'none';
        disconnected.style.display = isConnected() ? 'none' : 'block';
        if (email) email.textContent = session?.user?.email || 'Conta conectada';
        if (status) status.textContent = message || ({ online:'Sincronização instantânea ativa', connecting:'Conectando...', warning:'Conferindo alterações', error:'Falha de sincronização', local:'Somente neste aparelho' }[lastStatus] || 'Conectando...');
    }

    function renderDemoState() {
        const notice = document.getElementById('demoModeNotice');
        if (notice) notice.style.display = isDemoMode() ? 'flex' : 'none';
    }

    function turnstileSiteKey() {
        return document.querySelector('meta[name="alo-turnstile-site-key"]')?.content?.trim() || '';
    }

    function loadTurnstile() {
        if (global.turnstile?.render) return Promise.resolve(global.turnstile);
        if (turnstileLoader) return turnstileLoader;
        turnstileLoader = new Promise((resolve, reject) => {
            const ready = () => global.turnstile?.render
                ? resolve(global.turnstile)
                : reject(new Error('A verificação de segurança não foi carregada.'));
            const script = document.createElement('script');
            script.id = 'aloTurnstileScript';
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=aloTurnstileReady&render=explicit';
            script.async = true;
            script.defer = true;
            script.addEventListener('error', () => reject(new Error('A verificação de segurança não foi carregada.')), { once: true });
            global.aloTurnstileReady = ready;
            document.head.appendChild(script);
        });
        return turnstileLoader;
    }

    function resetTurnstile() {
        accessCaptchaToken = '';
        if (turnstileWidgetId !== null && global.turnstile?.reset) {
            try { global.turnstile.reset(turnstileWidgetId); } catch (error) {}
        }
    }

    function renderTurnstile() {
        const container = document.getElementById('cloudAccessTurnstile');
        const sitekey = turnstileSiteKey();
        if (!container || !sitekey) return;
        accessCaptchaToken = '';
        loadTurnstile().then(turnstile => {
            if (turnstileWidgetId !== null) {
                try { turnstile.remove(turnstileWidgetId); } catch (error) {}
            }
            container.replaceChildren();
            turnstileWidgetId = turnstile.render(container, {
                sitekey,
                theme: 'light',
                size: 'flexible',
                language: 'pt-BR',
                action: accessMode === 'signup' ? 'signup' : 'signin',
                appearance: 'always',
                callback: token => {
                    accessCaptchaToken = token || '';
                    if (!applyLoginGuard()) setAccessFeedback('');
                },
                'expired-callback': () => { accessCaptchaToken = ''; },
                'error-callback': () => {
                    accessCaptchaToken = '';
                    setAccessFeedback('Não foi possível concluir a verificação de segurança.', true);
                },
                'refresh-expired': 'auto'
            });
        }).catch(error => setAccessFeedback(error.message, true));
    }

    function readLoginGuard() {
        try {
            const value = JSON.parse(localStorage.getItem(LOGIN_GUARD_KEY) || 'null');
            if (!value) return { attempts: 0, lockedUntil: 0, windowUntil: 0 };
            const now = Date.now();
            const windowUntil = Number(value.windowUntil || value.lockedUntil || 0);
            if (windowUntil <= now) {
                localStorage.removeItem(LOGIN_GUARD_KEY);
                return { attempts: 0, lockedUntil: 0, windowUntil: 0 };
            }
            const lockedUntil = Number(value.lockedUntil || 0);
            if (lockedUntil > 0 && lockedUntil <= now) {
                localStorage.removeItem(LOGIN_GUARD_KEY);
                return { attempts: 0, lockedUntil: 0, windowUntil: 0 };
            }
            return {
                attempts: Math.max(0, Math.min(LOGIN_MAX_ATTEMPTS, Number(value.attempts || 0))),
                lockedUntil,
                windowUntil
            };
        } catch (error) {
            localStorage.removeItem(LOGIN_GUARD_KEY);
            return { attempts: 0, lockedUntil: 0, windowUntil: 0 };
        }
    }

    function saveLoginGuard(value) {
        localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(value));
        return value;
    }

    function clearLoginGuard() {
        localStorage.removeItem(LOGIN_GUARD_KEY);
        if (loginGuardTimer) global.clearTimeout(loginGuardTimer);
        loginGuardTimer = null;
    }

    function isInvalidCredentials(error) {
        return /invalid login credentials|email ou senha incorretos/i.test(String(error?.message || error || ''));
    }

    function registerInvalidLogin() {
        const current = readLoginGuard();
        const attempts = Math.min(LOGIN_MAX_ATTEMPTS, current.attempts + 1);
        const now = Date.now();
        return saveLoginGuard({
            attempts,
            lockedUntil: attempts >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_MS : 0,
            windowUntil: current.windowUntil > now ? current.windowUntil : now + LOGIN_ATTEMPT_WINDOW_MS
        });
    }

    function formatLoginLock(milliseconds) {
        const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    }

    function applyLoginGuard() {
        if (loginGuardTimer) global.clearTimeout(loginGuardTimer);
        loginGuardTimer = null;
        const submit = document.getElementById('cloudAccessSubmit');
        if (accessMode !== 'signin') {
            if (submit) submit.disabled = false;
            return false;
        }
        const guard = readLoginGuard();
        const remaining = guard.attempts >= LOGIN_MAX_ATTEMPTS ? guard.lockedUntil - Date.now() : 0;
        if (remaining <= 0) {
            if (submit) submit.disabled = false;
            return false;
        }
        if (submit) submit.disabled = true;
        setAccessFeedback(`Proteção temporária após 3 senhas incorretas. Tente novamente em ${formatLoginLock(remaining)}.`, true);
        loginGuardTimer = global.setTimeout(applyLoginGuard, 1000);
        return true;
    }

    function setAccessFeedback(message, error = false) {
        const element = document.getElementById('cloudAccessFeedback');
        if (!element) return;
        element.textContent = message || '';
        element.style.color = error ? '#b3261e' : '#0b6b57';
    }

    function setAccessMode(mode) {
        accessMode = mode === 'signup' ? 'signup' : 'signin';
        const signInTab = document.getElementById('cloudAccessSignInTab');
        const signUpTab = document.getElementById('cloudAccessSignUpTab');
        const nameGroup = document.getElementById('cloudAccessNameGroup');
        const submit = document.getElementById('cloudAccessSubmit');
        const recoverButton = document.getElementById('cloudAccessRecover');
        const password = document.getElementById('cloudAccessPassword');
        signInTab?.classList.toggle('active', accessMode === 'signin');
        signUpTab?.classList.toggle('active', accessMode === 'signup');
        signInTab?.setAttribute('aria-selected', String(accessMode === 'signin'));
        signUpTab?.setAttribute('aria-selected', String(accessMode === 'signup'));
        if (nameGroup) nameGroup.style.display = accessMode === 'signup' ? 'block' : 'none';
        if (submit) submit.textContent = accessMode === 'signup' ? 'Criar conta' : 'Entrar';
        if (recoverButton) recoverButton.style.display = accessMode === 'signin' ? 'block' : 'none';
        if (password) password.autocomplete = accessMode === 'signup' ? 'new-password' : 'current-password';
        setAccessFeedback('');
        applyLoginGuard();
        renderTurnstile();
    }

    function showAccessScreen() {
        const screen = document.getElementById('cloudAccessScreen');
        if (!screen) return;
        screen.style.display = 'block';
        setAccessMode('signin');
        setTimeout(() => document.getElementById('cloudAccessEmail')?.focus({ preventScroll: true }), 2200);
    }

    function hideAccessScreen() {
        const screen = document.getElementById('cloudAccessScreen');
        if (screen) screen.style.display = 'none';
    }

    function toggleAccessPassword() {
        const input = document.getElementById('cloudAccessPassword');
        const button = document.getElementById('cloudAccessPasswordToggle');
        if (!input || !button) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'Ocultar' : 'Mostrar';
    }

    async function submitAccess(event) {
        event?.preventDefault?.();
        const name = document.getElementById('cloudAccessName')?.value.trim() || '';
        const email = document.getElementById('cloudAccessEmail')?.value.trim() || '';
        const password = document.getElementById('cloudAccessPassword')?.value || '';
        const submit = document.getElementById('cloudAccessSubmit');
        const requestedMode = accessMode;
        if (requestedMode === 'signin' && applyLoginGuard()) return;
        if (!email || password.length < 6) return setAccessFeedback('Informe o e-mail e uma senha com pelo menos 6 caracteres.', true);
        const captchaToken = accessCaptchaToken;
        if (!captchaToken) return setAccessFeedback('Conclua a verificação de segurança.', true);
        if (submit) submit.disabled = true;
        setAccessFeedback(requestedMode === 'signup' ? 'Criando sua conta...' : 'Entrando...');
        try {
            if (requestedMode === 'signup') {
                const data = await signUp(name, email, password, captchaToken);
                if (isConnected()) global.location.reload();
                else {
                    setAccessMode('signin');
                    document.getElementById('cloudAccessEmail').value = email;
                    setAccessFeedback('Conta criada. Confirme o e-mail recebido e depois entre.');
                }
            } else {
                await signIn(email, password, captchaToken);
                clearLoginGuard();
                global.location.reload();
            }
        } catch (error) {
            resetTurnstile();
            if (requestedMode === 'signin' && isInvalidCredentials(error)) {
                const guard = registerInvalidLogin();
                const attemptsLeft = Math.max(0, LOGIN_MAX_ATTEMPTS - guard.attempts);
                if (!applyLoginGuard()) {
                    setAccessFeedback(`E-mail ou senha incorretos. ${attemptsLeft === 1 ? 'Resta 1 tentativa.' : `Restam ${attemptsLeft} tentativas.`}`, true);
                }
            } else {
                setAccessFeedback(errorMessage(error), true);
            }
        } finally {
            if (submit && !applyLoginGuard()) submit.disabled = false;
        }
    }

    async function recoverFromAccess() {
        const email = document.getElementById('cloudAccessEmail')?.value.trim() || '';
        if (!email) return setAccessFeedback('Digite o e-mail da sua conta.', true);
        if (!accessCaptchaToken) return setAccessFeedback('Conclua a verificação de segurança.', true);
        setAccessFeedback('Enviando o link...');
        try {
            await recover(email, accessCaptchaToken);
            resetTurnstile();
            setAccessFeedback('Enviamos o link para trocar sua senha.');
        } catch (error) {
            resetTurnstile();
            setAccessFeedback(errorMessage(error), true);
        }
    }

    function continueAccountActionFromAccess({ create = false, recoverPassword = false } = {}) {
        const name = document.getElementById('cloudAccountName')?.value.trim() || '';
        const email = document.getElementById('cloudAccountEmailInput')?.value.trim() || '';
        const password = document.getElementById('cloudAccountPassword')?.value || '';
        if (typeof global.fecharModal === 'function') global.fecharModal('modalConfigAvancadas');
        showAccessScreen();
        setAccessMode(create ? 'signup' : 'signin');
        const accessName = document.getElementById('cloudAccessName');
        const accessEmail = document.getElementById('cloudAccessEmail');
        const accessPassword = document.getElementById('cloudAccessPassword');
        if (accessName) accessName.value = name;
        if (accessEmail) accessEmail.value = email;
        if (accessPassword && !recoverPassword) accessPassword.value = password;
        setAccessFeedback(recoverPassword
            ? 'Toque em Esqueci minha senha para receber o link.'
            : '');
        setTimeout(() => (recoverPassword ? accessEmail : accessPassword)?.focus({ preventScroll: true }), 120);
    }

    function connectFromSettings(create = false) {
        continueAccountActionFromAccess({ create });
    }

    function recoverFromSettings() {
        continueAccountActionFromAccess({ recoverPassword: true });
    }

    global.AloCloud = Object.freeze({
        url: SUPABASE_URL,
        publishableKey: PUBLISHABLE_KEY,
        endpoint: ENDPOINT,
        fetch: cloudFetch,
        rpc,
        initialize,
        signIn,
        signUp,
        recover,
        signOut,
        getEndpoint,
        isEndpoint,
        isConnected,
        user: () => session?.user || null,
        connectFromSettings,
        recoverFromSettings,
        renderAccountSettings,
        errorMessage,
        setAccessMode,
        toggleAccessPassword,
        submitAccess,
        recoverFromAccess
    });

    global.addEventListener('online', () => {
        if (!session || isDemoMode()) return;
        recoveryAttempt = 0;
        initialize();
    });
    global.addEventListener('storage', event => {
        const ownsSessionKey = global.AloStorageScope?.ownsPhysicalKey;
        if (ownsSessionKey ? !ownsSessionKey(event.key, SESSION_KEY) : event.key !== SESSION_KEY) return;
        const stored = readSession();
        if (!stored?.access_token) {
            session = null;
            sessionInvalidated = true;
            emitStatus('local', 'Conta desconectada em outra aba');
            if (!isPublicTaskView()) showAccessScreen();
            return;
        }
        if (stored.access_token === session?.access_token && stored.refresh_token === session?.refresh_token) return;
        session = stored;
        sessionInvalidated = false;
        updateRealtimeToken();
        recoveryAttempt = 0;
        emitStatus('connecting', 'Sessão atualizada; reconectando...');
        initialize();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initialize());
    } else {
        initialize();
    }
})(window);
