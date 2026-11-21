(function () {
  "use strict";

  const frequencies = [220, 261.63, 293.66, 329.63, 392, 440];
  const stepSeconds = 0.38;
  const betweenVoices = 0.35;
  const tailSeconds = 0.82;
  const sampleRate = 44100;

  let context = null;
  let current = null;
  const previews = new Set();
  let generation = 0;
  let blend = 0.5;

  function validate(state) {
    if (!state || !Array.isArray(state.call) || !Array.isArray(state.reply)) {
      throw new TypeError("A conversa deve conter as duas vozes.");
    }
    const durations = {};
    for (const role of ["call", "reply"]) {
      const sequence = state[role];
      if (sequence.length > 8 || sequence.some(note => !Number.isInteger(note) || note < 0 || note >= frequencies.length)) {
        throw new RangeError("Cada voz aceita até oito notas de 0 a 5.");
      }
      const supplied = state.durations && state.durations[role];
      if (supplied !== undefined && (!Array.isArray(supplied) || supplied.some(value => value !== 1 && value !== 2))) {
        throw new RangeError("As durações das notas devem ser 1 ou 2.");
      }
      durations[role] = sequence.map((_, index) => (supplied && supplied[index]) || 1);
    }
    return { call: state.call.slice(), reply: state.reply.slice(), durations };
  }

  function buildScore(state) {
    const song = validate(state);
    const events = [];
    let time = 0;

    for (const role of ["call", "reply"]) {
      if (!song[role].length) continue;
      if (events.length) time += betweenVoices;
      song[role].forEach((note, index) => {
        const duration = song.durations[role][index] * stepSeconds;
        events.push({ role, index, note, time, duration, together: false });
        time += duration;
      });
    }

    if (song.call.length && song.reply.length) {
      time += betweenVoices;
      const lengths = {
        call: song.durations.call.reduce((total, value) => total + value * stepSeconds, 0),
        reply: song.durations.reply.reduce((total, value) => total + value * stepSeconds, 0)
      };
      for (const role of ["call", "reply"]) {
        let offset = 0;
        const other = role === "call" ? "reply" : "call";
        song[role].forEach((note, index) => {
          const duration = song.durations[role][index] * stepSeconds;
          events.push({ role, index, note, time: time + offset, duration, together: offset < lengths[other] });
          offset += duration;
        });
      }
      time += Math.max(lengths.call, lengths.reply);
    }

    events.sort((a, b) => a.time - b.time);
    return { events, duration: events.length ? time + tailSeconds : 0 };
  }

  function audioContext() {
    if (!context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("Seu navegador não oferece áudio neste dispositivo.");
      context = new Context();
    }
    return context;
  }

  function blendValue(role) {
    return role === "call" ? Math.cos(blend * Math.PI / 2) : Math.sin(blend * Math.PI / 2);
  }

  function makeOutput(ctx) {
    const master = ctx.createGain();
    const call = ctx.createGain();
    const reply = ctx.createGain();
    master.gain.value = 0.72;
    call.gain.value = blendValue("call");
    reply.gain.value = blendValue("reply");
    call.connect(master);
    reply.connect(master);
    master.connect(ctx.destination);
    return { master, call, reply };
  }

  function scheduleTone(ctx, output, note, role, when, together, oscillators, duration = stepSeconds) {
    const envelope = ctx.createGain();
    const partial = ctx.createGain();
    const fundamental = ctx.createOscillator();
    const harmonic = ctx.createOscillator();

    fundamental.type = role === "reply" ? "triangle" : "sine";
    fundamental.frequency.value = frequencies[note] * (role === "reply" ? 2 : 1);
    harmonic.type = "sine";
    harmonic.frequency.value = frequencies[note] * (role === "reply" ? 3 : 2);
    partial.gain.value = role === "reply" ? 0.12 : 0.18;

    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.16, when + 0.025);
    envelope.gain.setValueAtTime(0.16, when + duration - 0.12);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.24);
    fundamental.connect(envelope);
    harmonic.connect(partial);
    partial.connect(envelope);
    envelope.connect(together ? output[role] : output.master);

    fundamental.start(when);
    harmonic.start(when);
    fundamental.stop(when + duration + 0.25);
    harmonic.stop(when + duration + 0.25);
    if (oscillators) oscillators.push(fundamental, harmonic);
  }

  function stop() {
    generation += 1;
    for (const preview of previews) {
      clearTimeout(preview.timer);
      for (const oscillator of preview.oscillators) {
        try { oscillator.stop(); } catch (_) {}
      }
      try { preview.output.master.disconnect(); } catch (_) {}
    }
    previews.clear();
    if (!current) return;
    for (const timer of current.timers) clearTimeout(timer);
    for (const oscillator of current.oscillators) {
      try { oscillator.stop(); } catch (_) {}
    }
    try { current.output.master.disconnect(); } catch (_) {}
    current = null;
  }

  async function ready(ctx) {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") throw new Error("Toque na página para ativar o áudio.");
  }

  async function preview(index, role) {
    if (!Number.isInteger(index) || index < 0 || index >= frequencies.length || !["call", "reply"].includes(role)) {
      throw new RangeError("Nota ou voz inválida.");
    }
    const request = generation;
    const ctx = audioContext();
    await ready(ctx);
    if (request !== generation) return;
    const output = makeOutput(ctx);
    const oscillators = [];
    scheduleTone(ctx, output, index, role, ctx.currentTime + 0.01, false, oscillators);
    const preview = { output, oscillators, timer: null };
    preview.timer = window.setTimeout(() => {
      previews.delete(preview);
      try { output.master.disconnect(); } catch (_) {}
    }, 1000);
    previews.add(preview);
  }

  async function play(state, callbacks) {
    const score = buildScore(state);
    stop();
    const request = generation;
    if (!score.events.length) {
      if (callbacks && typeof callbacks.onEnd === "function") callbacks.onEnd();
      return;
    }

    const ctx = audioContext();
    await ready(ctx);
    if (request !== generation) return;

    const output = makeOutput(ctx);
    const run = { output, oscillators: [], timers: [] };
    current = run;
    const start = ctx.currentTime + 0.05;
    for (const event of score.events) {
      scheduleTone(ctx, output, event.note, event.role, start + event.time, event.together, run.oscillators, event.duration);
      if (callbacks && typeof callbacks.onStep === "function") {
        const timer = window.setTimeout(() => {
          if (current === run) callbacks.onStep(event.role, event.index);
        }, Math.round((0.05 + event.time) * 1000));
        run.timers.push(timer);
      }
    }
    run.timers.push(window.setTimeout(() => {
      if (current !== run) return;
      current = null;
      try { output.master.disconnect(); } catch (_) {}
      if (callbacks && typeof callbacks.onEnd === "function") callbacks.onEnd();
    }, Math.round((0.05 + score.duration) * 1000)));
  }

  function setBlend(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Balanço inválido.");
    blend = Math.max(0, Math.min(1, value));
    if (!current || !context) return;
    for (const role of ["call", "reply"]) {
      current.output[role].gain.setTargetAtTime(blendValue(role), context.currentTime, 0.03);
    }
  }

  function encodeWave(buffer) {
    const frames = buffer.length;
    const channels = buffer.numberOfChannels;
    const bytes = new ArrayBuffer(44 + frames * channels * 2);
    const view = new DataView(bytes);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + frames * channels * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, frames * channels * 2, true);

    const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    let position = 44;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, samples[channel][frame]));
        view.setInt16(position, sample < 0 ? sample * 32768 : sample * 32767, true);
        position += 2;
      }
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  async function wav(state) {
    const score = buildScore(state);
    if (!score.events.length) throw new Error("Adicione pelo menos uma nota para baixar o áudio.");
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error("Seu navegador não consegue gerar o arquivo de áudio.");
    const offline = new OfflineContext(2, Math.ceil(score.duration * sampleRate), sampleRate);
    const output = makeOutput(offline);
    for (const event of score.events) {
      scheduleTone(offline, output, event.note, event.role, event.time, event.together, undefined, event.duration);
    }
    return encodeWave(await offline.startRendering());
  }

  window.DuetAudio = { preview, play, stop, setBlend, wav };
}());

