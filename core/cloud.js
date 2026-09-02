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
    let refreshPromise = null;
    let recoveryTimer = null;
    let recoveryAttempt = 0;
    let realtimeClient = null;
    let lastStatus = session ? 'connecting' : 'local';
    let accessMode = 'signin';
    let accessChallenge = { answer: 0, selected: null, options: [] };

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
        if (recoveryTimer || !session || isDemoMode() || !navigator.onLine) return;
        const wait = Math.min(60000, Math.max(delay, 5000) * Math.max(1, recoveryAttempt + 1));
        recoveryTimer = global.setTimeout(async () => {
            recoveryTimer = null;
            const recovered = await initialize();
            if (!recovered) {
                recoveryAttempt = Math.min(recoveryAttempt + 1, 6);
                scheduleRecovery(5000);
            }
        }, wait);
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
        if (refreshPromise) return refreshPromise;
        const attemptedRefreshToken = session.refresh_token;
        refreshPromise = (async () => {
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
            updateRealtimeToken();
            recoveryAttempt = 0;
            emitStatus('online', 'Conexão com a nuvem restabelecida');
            global.setTimeout(wakeAllModules, 0);
            return refreshed;
        })().catch(error => {
            scheduleRecovery();
            throw error;
        }).finally(() => {
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
            headers.set('Authorization', `Bearer ${session.access_token}`);
            try {
                response = await request();
            } catch (error) {
                scheduleRecovery();
                throw error;
            }
            if (response.status === 401) scheduleRecovery();
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
                scheduleRecovery();
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
        if (recoveryTimer) global.clearTimeout(recoveryTimer);
        recoveryTimer = null;
        recoveryAttempt = 0;
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

    function createAccessChallenge() {
        const left = 2 + Math.floor(Math.random() * 7);
        const right = 1 + Math.floor(Math.random() * 6);
        const answer = left + right;
        const options = [...new Set([answer, answer + 1 + Math.floor(Math.random() * 2), Math.max(1, answer - 1 - Math.floor(Math.random() * 2))])];
        while (options.length < 3) options.push(answer + options.length + 1);
        options.sort(() => Math.random() - 0.5);
        accessChallenge = { question: `${left} + ${right}`, answer, selected: null, options };
        renderAccessChallenge();
    }

    function renderAccessChallenge() {
        const question = document.getElementById('cloudAccessChallengeQuestion');
        const container = document.getElementById('cloudAccessChallengeOptions');
        if (!question || !container) return;
        question.textContent = accessChallenge.question || '2 + 3';
        container.replaceChildren(...accessChallenge.options.map(value => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = String(value);
            button.className = accessChallenge.selected === value ? 'selected' : '';
            button.setAttribute('aria-pressed', String(accessChallenge.selected === value));
            button.addEventListener('click', () => selectAccessChallenge(value));
            return button;
        }));
    }

    function selectAccessChallenge(value) {
        accessChallenge.selected = Number(value);
        renderAccessChallenge();
        setAccessFeedback('');
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
        createAccessChallenge();
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
        if (!email || password.length < 6) return setAccessFeedback('Informe o e-mail e uma senha com pelo menos 6 caracteres.', true);
        if (accessChallenge.selected !== accessChallenge.answer) {
            createAccessChallenge();
            return setAccessFeedback('Conclua a verificação rápida.', true);
        }
        if (submit) submit.disabled = true;
        setAccessFeedback(accessMode === 'signup' ? 'Criando sua conta...' : 'Entrando...');
        try {
            if (accessMode === 'signup') {
                const data = await signUp(name, email, password);
                if (isConnected()) global.location.reload();
                else {
                    setAccessMode('signin');
                    document.getElementById('cloudAccessEmail').value = email;
                    setAccessFeedback('Conta criada. Confirme o e-mail recebido e depois entre.');
                }
            } else {
                await signIn(email, password);
                global.location.reload();
            }
        } catch (error) {
            createAccessChallenge();
            setAccessFeedback(errorMessage(error), true);
        } finally {
            if (submit) submit.disabled = false;
        }
    }

    async function recoverFromAccess() {
        const email = document.getElementById('cloudAccessEmail')?.value.trim() || '';
        if (!email) return setAccessFeedback('Digite o e-mail da sua conta.', true);
        setAccessFeedback('Enviando o link...');
        try {
            await recover(email);
            setAccessFeedback('Enviamos o link para trocar sua senha.');
        } catch (error) {
            setAccessFeedback(errorMessage(error), true);
        }
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
        errorMessage,
        setAccessMode,
        selectAccessChallenge,
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
        if (event.key !== SESSION_KEY) return;
        const stored = readSession();
        if (!stored?.access_token || stored.access_token === session?.access_token) return;
        session = stored;
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
