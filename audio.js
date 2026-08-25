(function (global) {
    const sounds = {
        sem_som: { type: 'silent' },
        alarme: { type: 'audio', url: './assets/sounds/alarme-curto.ogg' },
        beep: { type: 'audio', url: './assets/sounds/beep-classico.ogg' },
        sino_forte: { type: 'audio', url: './assets/sounds/sino-forte.ogg' },
        sirene_cozinha: { type: 'synthetic', interval: 950 },
        alerta_triplo: { type: 'synthetic', interval: 850 },
        campainha_forte: { type: 'synthetic', interval: 1000 },
        toque_urgente: { type: 'synthetic', interval: 750 }
    };
    let player = new Audio();
    let preview = null;
    let previewTimer = null;
    let context = null;
    let syntheticTimer = null;
    let finiteSoundTimer = null;
    let playingKey = 'sem_som';
    let playingVolume = -1;
    let playingMode = '';

    function normalize(value, fallback) {
        return value === 'sem_som' || sounds[value] ? value : fallback;
    }

    function audioContext() {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) return null;
        if (!context) context = new AudioContextClass();
        if (context.state === 'suspended') context.resume().catch(() => {});
        return context;
    }

    function volumeFor(selectId) {
        const volumeId = selectId === 'configSomPanelas' ? 'configVolumePanelas' : 'configVolumeCozinha';
        const input = document.getElementById(volumeId);
        return Math.max(0, Math.min(100, Number(input ? input.value : 100))) / 100;
    }

    function updateVolumeLabels() {
        [['configVolumeCozinha', 'labelVolumeCozinha'], ['configVolumePanelas', 'labelVolumePanelas']].forEach(([inputId, labelId]) => {
            const input = document.getElementById(inputId);
            const label = document.getElementById(labelId);
            if (input && label) label.innerText = `${input.value}%`;
        });
    }

    function playPulse(startFrequency, endFrequency, delay, duration, volume, wave, layers) {
        const ctx = audioContext();
        if (!ctx || volume <= 0) return;
        const startsAt = ctx.currentTime + delay;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.ratio.value = 12;
        compressor.connect(ctx.destination);
        for (let index = 0; index < layers; index++) {
            const offset = (index - (layers - 1) / 2) * 18;
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = wave;
            oscillator.frequency.setValueAtTime(startFrequency + offset, startsAt);
            oscillator.frequency.linearRampToValueAtTime(endFrequency + offset, startsAt + duration);
            gain.gain.setValueAtTime(0.0001, startsAt);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.75), startsAt + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
            oscillator.connect(gain).connect(compressor);
            oscillator.start(startsAt);
            oscillator.stop(startsAt + duration + 0.04);
        }
        setTimeout(() => { try { compressor.disconnect(); } catch (error) {} }, (delay + duration + 0.3) * 1000);
    }

    function playNoise(delay, duration, volume) {
        const ctx = audioContext();
        if (!ctx || volume <= 0) return;
        const startsAt = ctx.currentTime + delay;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = (Math.random() * 2 - 1) * 0.55;
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        filter.type = 'bandpass';
        filter.frequency.value = 1600;
        filter.Q.value = 1.6;
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.55), startsAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(startsAt);
        source.stop(startsAt + duration + 0.04);
    }

    function playSynthetic(key, volume) {
        if (navigator.vibrate) navigator.vibrate(key === 'toque_urgente' ? [120, 60, 120, 60, 220] : [180, 70, 180]);
        if (key === 'alarme') {
            playPulse(920, 1550, 0, 0.16, volume, 'square', 3);
            playPulse(1550, 920, 0.22, 0.16, volume, 'square', 3);
        } else if (key === 'beep') {
            playPulse(1100, 1100, 0, 0.10, volume, 'square', 2);
        } else if (key === 'sino_forte') {
            playPulse(1250, 840, 0, 0.55, volume, 'sine', 4);
            playPulse(1650, 1100, 0.08, 0.42, volume, 'triangle', 3);
        } else if (key === 'sirene_cozinha') {
            playPulse(560, 1420, 0, 0.34, volume, 'square', 3);
            playNoise(0.02, 0.18, volume);
            playPulse(1420, 560, 0.38, 0.34, volume, 'square', 3);
            playNoise(0.40, 0.16, volume);
        } else if (key === 'alerta_triplo') {
            [0, 0.22, 0.44].forEach((delay, index) => {
                playPulse(index === 1 ? 1480 : 1180, index === 1 ? 1480 : 1180, delay, index === 2 ? 0.22 : 0.16, volume, 'square', 3);
                playNoise(delay, index === 2 ? 0.14 : 0.12, volume);
            });
        } else if (key === 'campainha_forte') {
            playPulse(920, 1620, 0, 0.18, volume, 'sine', 4);
            playPulse(1620, 920, 0.2, 0.18, volume, 'sine', 4);
            playPulse(1180, 1180, 0.48, 0.25, volume, 'triangle', 4);
        } else if (key === 'toque_urgente') {
            [[780, 0, 0.12], [980, 0.14, 0.12], [1280, 0.28, 0.18], [1620, 0.5, 0.22]].forEach(([frequency, delay, duration]) => playPulse(frequency, frequency, delay, duration, volume, delay === 0.5 ? 'square' : 'sawtooth', 3));
            playNoise(0.5, 0.16, volume);
        }
    }

    function stopSynthetic() {
        if (syntheticTimer) clearInterval(syntheticTimer);
        syntheticTimer = null;
        if (finiteSoundTimer) clearTimeout(finiteSoundTimer);
        finiteSoundTimer = null;
    }

    function startSyntheticLoop(key, volume, interval) {
        playSynthetic(key, volume);
        syntheticTimer = setInterval(() => playSynthetic(key, volume), interval);
    }

    function resetPlayerPosition() {
        try { player.currentTime = 0; } catch (error) {}
    }

    function stopPlayback() {
        player.pause();
        player.loop = false;
        player.onerror = null;
        player.onended = null;
        resetPlayerPosition();
        stopSynthetic();
        playingKey = 'sem_som';
        playingVolume = -1;
        playingMode = '';
    }

    function stop() {
        stopPlayback();
        const header = document.getElementById('mainHeader');
        if (header) header.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
    }

    function startContinuousSound(key, volume, mode = 'cozinha') {
        if (playingMode === mode && playingKey === key && Math.abs(playingVolume - volume) < 0.01) return;
        stopPlayback();
        const sound = sounds[key];
        playingKey = key;
        playingVolume = volume;
        playingMode = mode;
        if (sound.type === 'audio') {
            player.src = sound.url;
            player.loop = true;
            player.volume = volume;
            const useSyntheticSound = () => {
                if (playingMode !== mode || playingKey !== key || syntheticTimer) return;
                player.pause();
                startSyntheticLoop(key, volume, key === 'beep' ? 1000 : 1200);
            };
            player.onerror = useSyntheticSound;
            player.play().catch(useSyntheticSound);
            return;
        }
        startSyntheticLoop(key, volume, sound.interval);
    }

    function previewSound(selectId) {
        if (preview) { preview.pause(); preview.currentTime = 0; }
        if (previewTimer) clearTimeout(previewTimer);
        const key = normalize(document.getElementById(selectId).value, selectId === 'configSomPanelas' ? 'beep' : 'sirene_cozinha');
        if (key === 'sem_som') return;
        const sound = sounds[key];
        const volume = volumeFor(selectId);
        if (sound.type === 'audio') {
            preview = new Audio(sound.url);
            preview.volume = volume;
            preview.play().catch(() => playSynthetic(key, volume));
            preview.onerror = () => playSynthetic(key, volume);
            previewTimer = setTimeout(() => preview && preview.pause(), 3000);
        } else {
            playSynthetic(key, volume);
        }
    }

    function manage({ mode, modo, configs, orders, knownIds }) {
        mode = mode || modo;
        const header = document.getElementById('mainHeader');
        if (!header) return;
        header.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
        if (mode === 'cozinha') {
            const hasPendingOrder = orders.some(order => order.status === 'pendente' && global.AloLogic.isToday(order.timestamp));
            if (!hasPendingOrder) return stop();
            header.classList.add('alerta-pisca');
            const key = normalize(configs.somCozinha || 'sem_som', 'sirene_cozinha');
            if (key === 'sem_som') return stopPlayback();
            const volume = Math.max(0, Math.min(100, Number(configs.volumeCozinha || 100))) / 100;
            startContinuousSound(key, volume);
            return;
        }

        if (playingMode === 'cozinha') stopPlayback();
        const now = Date.now();
        const needsConfirmation = order => {
            const elapsed = now - new Date(order.finalizadoEm).getTime();
            return Number.isFinite(elapsed) && elapsed >= -60000 && elapsed < 300000
                && !order.alertaReconhecidoEm && !knownIds.has(String(order.id));
        };
        const alerts = orders.filter(order => (order.status === 'cancelado' || order.status === 'buscar') && needsConfirmation(order));
        if (!alerts.length) return stop();
        header.classList.add('alerta-pisca-buscar');

        const hasCancellation = alerts.some(order => order.status === 'cancelado');
        const key = hasCancellation ? 'beep' : normalize(configs.somPanelas || 'sem_som', 'beep');
        if (key === 'sem_som') return stopPlayback();
        const volume = Math.max(0, Math.min(100, Number(configs.volumePanelas || 70))) / 100;
        startContinuousSound(key, volume, 'panelas');
    }

    function unlock() {
        const ctx = audioContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        if (playingKey !== 'sem_som' && player.paused && player.src) {
            player.play().catch(() => {});
        }
    }

    global.AloAudio = Object.freeze({
        sounds,
        normalize,
        volumeFor,
        updateVolumeLabels,
        previewSound,
        manage,
        stop,
        unlock
    });
})(window);
