(function (global) {
    const SUPABASE_URL = 'https://sxbcjzshcjxzladwptiu.supabase.co';
    const PUBLISHABLE_KEY = 'sb_publishable_U5ZEfqHRxIJc1abrIzV0cg_keNdZvuK';
    const ENDPOINT = `${SUPABASE_URL}/functions/v1/alo-cozinha-sync`;
    const SESSION_KEY = 'alo_supabase_session_v1';
    const DEVICE_KEY = 'alo_cloud_device_id_v1';
    const ACCOUNT_SITE = 'https://lincolnpontes.github.io/alo-etiqueta-conta/';
    let session = readSession();
    let channel = null;
    let initializing = null;
    let realtimeClient = null;
    let lastStatus = session ? 'connecting' : 'local';

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
        renderAccountSettings();
        return session;
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

    function errorMessage(error) {
        const raw = String(error?.message || error || 'Falha inesperada.');
        const translations = [
            [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
            [/email not confirmed/i, 'Confirme o e-mail recebido antes de entrar.'],
            [/user already registered/i, 'Este e-mail já possui uma conta.'],
            [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
            [/unable to validate email/i, 'Digite um e-mail válido.'],
            [/failed to fetch|networkerror|load failed/i, 'Sem conexão com a nuvem. Seus dados locais continuam seguros.']
        ];
        return translations.find(([pattern]) => pattern.test(raw))?.[1] || raw;
    }

    async function parseResponse(response) {
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (error) { data = text; }
        if (!response.ok) {
            throw new Error(data?.message || data?.msg || data?.error_description || data?.error || `Falha no servidor (${response.status}).`);
        }
        return data;
    }

    async function refreshSession() {
        if (!session?.refresh_token) throw new Error('Conecte a conta da nuvem nas configurações.');
        const response = await global.fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        return saveSession(await parseResponse(response));
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
        let response = await request();
        if (response.status === 401) {
            await refreshSession();
            headers.set('Authorization', `Bearer ${session.access_token}`);
            response = await request();
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
        await realtimeClient.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
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
            if (!session) {
                emitStatus('local', 'Dados somente neste aparelho até conectar uma conta');
                return false;
            }
            try {
                await ensureSession();
                await rpc('bootstrap_account', { p_display_name: session.user?.user_metadata?.display_name || null });
                await startRealtime();
                emitStatus('online', 'Conta conectada ao Supabase');
                global.dispatchEvent(new CustomEvent('alo:cloud-ready', { detail: { endpoint: ENDPOINT } }));
                return true;
            } catch (error) {
                emitStatus('error', errorMessage(error));
                return false;
            }
        })().finally(() => { initializing = null; });
        return initializing;
    }

    async function signIn(email, password) {
        const data = await authRequest('/auth/v1/token?grant_type=password', { email, password });
        saveSession(data);
        await initialize();
        return data;
    }

    async function signUp(name, email, password) {
        const data = await authRequest(`/auth/v1/signup?redirect_to=${encodeURIComponent(ACCOUNT_SITE)}`, {
            email, password,
            data: { display_name: name || '' }
        });
        if (data?.session?.access_token) saveSession(data.session);
        else if (data?.access_token) saveSession(data);
        return data;
    }

    async function recover(email) {
        return authRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(ACCOUNT_SITE)}`, { email });
    }

    async function signOut() {
        try {
            if (session) await cloudFetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST' });
        } catch (error) {}
        if (channel && realtimeClient) await realtimeClient.removeChannel(channel).catch(() => {});
        channel = null;
        realtimeClient = null;
        session = null;
        localStorage.removeItem(SESSION_KEY);
        emitStatus('local', 'Conta desconectada; dados locais preservados');
        renderAccountSettings();
    }

    function getEndpoint() {
        return session ? ENDPOINT : '';
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
        return Boolean(session?.access_token && session?.refresh_token);
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

    async function connectFromSettings(create = false) {
        const name = document.getElementById('cloudAccountName')?.value.trim() || '';
        const email = document.getElementById('cloudAccountEmailInput')?.value.trim() || '';
        const password = document.getElementById('cloudAccountPassword')?.value || '';
        if (!email || password.length < 6) return setFeedback('Informe o e-mail e uma senha com pelo menos 6 caracteres.', true);
        setFeedback(create ? 'Criando conta...' : 'Conectando...');
        try {
            if (create) {
                const data = await signUp(name, email, password);
                if (!isConnected()) setFeedback('Conta criada. Confirme o e-mail recebido e depois toque em Entrar.');
                else setFeedback('Conta criada e conectada.');
            } else {
                await signIn(email, password);
                setFeedback('Conta conectada. Os módulos já podem sincronizar.');
                global.location.reload();
            }
        } catch (error) {
            setFeedback(errorMessage(error), true);
        }
    }

    async function recoverFromSettings() {
        const email = document.getElementById('cloudAccountEmailInput')?.value.trim() || '';
        if (!email) return setFeedback('Digite o e-mail da conta.', true);
        try {
            await recover(email);
            setFeedback('Enviamos o link para trocar a senha.');
        } catch (error) {
            setFeedback(errorMessage(error), true);
        }
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
        errorMessage
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initialize());
    } else {
        initialize();
    }
})(window);
