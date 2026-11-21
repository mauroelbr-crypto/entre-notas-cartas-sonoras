(function () {
  'use strict';

  const palette = [
    [255, 191, 143], [247, 151, 113], [226, 111, 84],
    [195, 83, 79], [172, 91, 110], [166, 122, 159],
    [195, 155, 188], [135, 101, 149]
  ];

  function cleanNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes
      .filter(note => Number.isFinite(note))
      .map(note => Math.min(5, Math.max(0, note)));
  }

  function makeTrack(notes, durations) {
    let elapsed = 0;
    const centers = notes.map((note, index) => {
      const duration = Array.isArray(durations) && Number.isFinite(durations[index]) && durations[index] > 0
        ? durations[index]
        : 1;
      const center = elapsed + duration / 2;
      elapsed += duration;
      return center;
    });
    return { notes, centers, total: elapsed };
  }

  function sample(track, t) {
    const { notes, centers, total } = track;
    if (notes.length === 1) return notes[0];
    const time = t * total;
    if (time <= centers[0]) return notes[0];
    const last = notes.length - 1;
    if (time >= centers[last]) return notes[last];
    let index = 0;
    while (time > centers[index + 1]) index++;
    const blend = (time - centers[index]) / (centers[index + 1] - centers[index]);
    const eased = blend * blend * (3 - 2 * blend);
    return notes[index] * (1 - eased) + notes[index + 1] * eased;
  }

  function draw(canvas, state) {
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const options = state || {};
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width || canvas.clientWidth || 600);
    const height = Math.max(1, bounds.height || canvas.clientHeight || 360);
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    let first = cleanNotes(options.call);
    let second = cleanNotes(options.reply);
    if (!first.length && !second.length) {
      first = [1, 3, 2, 4, 2, 5, 3, 1];
      second = [3, 1, 4, 2, 5, 2, 4, 3];
    } else {
      if (!first.length) first = second;
      if (!second.length) second = first;
    }
    const durations = options.durations || {};
    const firstTrack = makeTrack(first, durations.call);
    const secondTrack = makeTrack(second, durations.reply);
    const angle = Math.min(90, Math.max(0, Number(options.angle) || 0)) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#12182b');
    background.addColorStop(0.6, '#1a233b');
    background.addColorStop(1, '#26344d');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(width * .5, height * .46, 0, width * .5, height * .46, width * .47);
    glow.addColorStop(0, 'rgba(133, 108, 137, .18)');
    glow.addColorStop(1, 'rgba(27, 35, 55, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    // The centreline has two independent height axes. Looking from either
    // endpoint projects exactly one voice; the intermediate view blends both.
    function shapeAt(t) {
      const firstHeight = (sample(firstTrack, t) - 2.5) / 2.5;
      const secondHeight = (sample(secondTrack, t) - 2.5) / 2.5;
      return {
        firstHeight,
        secondHeight,
        twist: t * Math.PI * 2.1 + (firstHeight - secondHeight) * .48,
        radiusY: .29 + .045 * Math.sin(t * Math.PI * 2),
        radiusZ: .16 + .025 * Math.cos(t * Math.PI * 4)
      };
    }

    function project(t, phi) {
      const shape = shapeAt(t);
      const twistCos = Math.cos(shape.twist);
      const twistSin = Math.sin(shape.twist);
      const across = Math.cos(phi) * shape.radiusY;
      const up = Math.sin(phi) * shape.radiusZ;
      const offsetY = across * twistCos - up * twistSin;
      const offsetZ = across * twistSin + up * twistCos;
      const verticalOffset = offsetZ * cosine + offsetY * sine;
      const depthOffset = offsetY * cosine - offsetZ * sine;
      const center = shape.firstHeight * cosine + shape.secondHeight * sine;
      return {
        x: width * (.1 + .8 * t + depthOffset * .055),
        y: height * (.5 - center * .28 - verticalOffset * .40),
        depth: depthOffset,
        shape
      };
    }

    function surfaceLight(phi, twist) {
      const normalY = Math.cos(phi + twist);
      const normalZ = Math.sin(phi + twist);
      const vertical = normalZ * cosine + normalY * sine;
      const depth = normalY * cosine - normalZ * sine;
      const diffuse = Math.max(0, vertical * .76 + depth * .64);
      const highlight = Math.pow(diffuse, 8);
      return Math.min(1.14, .32 + diffuse * .65 + highlight * .22);
    }

    context.save();
    context.filter = 'blur(18px)';
    context.fillStyle = 'rgba(4, 7, 17, .52)';
    context.beginPath();
    context.ellipse(width * .52, height * .76, width * .36, height * .075, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const bands = 24;
    const segments = 56;
    const vertices = Array.from({ length: segments + 1 }, (_, step) =>
      Array.from({ length: bands + 1 }, (_, band) =>
        project(step / segments, band * Math.PI * 2 / bands))
    );
    const faces = [];
    for (let step = 0; step < segments; step++) {
      for (let band = 0; band < bands; band++) {
        const points = [vertices[step][band], vertices[step + 1][band], vertices[step + 1][band + 1], vertices[step][band + 1]];
        const middle = (step + .5) / segments;
        const phi = (band + .5) * Math.PI * 2 / bands;
        const shade = surfaceLight(phi, shapeAt(middle).twist);
        const base = palette[Math.floor(band * palette.length / bands)];
        faces.push({
          points,
          depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length,
          color: base.map(channel => Math.min(255, Math.round(channel * shade)))
        });
      }
    }
    faces.sort((a, b) => a.depth - b.depth);
    context.save();
    context.lineJoin = 'round';
    for (const face of faces) {
      context.beginPath();
      context.moveTo(face.points[0].x, face.points[0].y);
      face.points.slice(1).forEach(point => context.lineTo(point.x, point.y));
      context.closePath();
      context.fillStyle = `rgb(${face.color.join(',')})`;
      context.fill();
    }
    context.restore();

    const progress = Number(options.progress);
    if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
      const firstHeight = (sample(firstTrack, progress) - 2.5) / 2.5;
      const secondHeight = (sample(secondTrack, progress) - 2.5) / 2.5;
      const point = {
        x: width * (.1 + .8 * progress),
        y: height * (.5 - (firstHeight * cosine + secondHeight * sine) * .28)
      };
      context.save();
      context.shadowColor = '#fff2ce';
      context.shadowBlur = 15;
      context.fillStyle = '#fff4d8';
      context.beginPath();
      context.arc(point.x, point.y, Math.max(3, width / 180), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  window.DuetArt = { draw };
})();
