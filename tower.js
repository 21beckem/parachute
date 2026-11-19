// Decorative SVG crew: one shared clock, separate routines and preparation cues.
(() => {
    const host = document.createElement('div');
    host.className = 'control-tower';
    host.setAttribute('aria-hidden', 'true');
    const path = (d, fill = 'none', extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
    const rect = (x, y, w, h, fill, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
    const crew = i => `<g class="parcel parcel-${i}">
        <g class="parcel-body">
            <g class="parcel-feet">${path('M-11 18v17m22-17v17', 'none', 'stroke-width="4"')}
                <ellipse class="foot-left" cx="-13" cy="36" rx="7" ry="3" fill="#435b70"/>
                <ellipse class="foot-right" cx="13" cy="36" rx="7" ry="3" fill="#435b70"/></g>
            ${path('M-23-25-15-32H31L23-25Z', '#f6d6a1')}
            ${path('M23-25 31-32V18L23 25Z', '#c99364')}
            ${path('M-23-25H23V25H-23Z', ['#e9bc82', '#f0ca91', '#dfae76'][i])}
            ${path('M-7-32H4L-4-25V-15H-14V-25Z', '#fff0c3', 'stroke="none"')}
            <g class="parcel-face"><g class="parcel-eyes"><ellipse cx="-10" cy="-3" rx="2" ry="3" fill="#293d52"/><ellipse cx="10" cy="-3" rx="2" ry="3" fill="#293d52"/></g>
            ${path('M-6 8q6 7 12 0', 'none', 'stroke-width="2"')}</g>
            ${i === 1 ? `<g class="crew-controller">
                ${path('M-12 13H12Q18 13 20 19l2 7q-2 5-7 0l-4-4H-11l-4 4q-5 5-7 0l2-7q2-6 8-6Z', '#526a84', 'stroke-width="2"')}
                ${path('M-11 15v7m-3-3h6', 'none', 'stroke="#fff0c3" stroke-width="2"')}
                <circle cx="11" cy="17" r="1.8" fill="#ee9383" stroke="none"/><circle cx="15" cy="20" r="1.8" fill="#b9d48e" stroke="none"/>
                ${rect(-3, 16, 6, 2, '#9eb6c9', 1)}
                <circle cx="-19" cy="20" r="3.2" fill="#ffebc4" stroke-width="1.5"/><circle cx="19" cy="20" r="3.2" fill="#ffebc4" stroke-width="1.5"/>
            </g>` : ''}
            <path class="arm-left" fill="none" stroke-width="4"/><path class="arm-right" fill="none" stroke-width="4"/>
            <circle class="hand-left" r="4.5" fill="#ffebc4"/><circle class="hand-right" r="4.5" fill="#ffebc4"/>
            <g class="crew-headset">${path('M-28-4V-13Q-28-43 0-43T28-13V-4', 'none', 'stroke-width="5"')}
                ${rect(-33, -12, 10, 22, ['#729dbb', '#d98976', '#91ad7d'][i], 4)}${rect(23, -12, 10, 22, ['#729dbb', '#d98976', '#91ad7d'][i], 4)}
                ${path('M28 7q0 13-17 13', 'none', 'stroke-width="2"')}${rect(5, 17, 10, 5, '#435b70')}
            </g>
            <g class="crew-files">${rect(-17, 9, 35, 23, '#e3b46e')}${rect(-12, 2, 25, 23, '#fffaf0')}${path('M-6 9H7M-6 14H4', 'none', 'stroke="#8ba6b7" stroke-width="1.5"')}</g>
        </g>
    </g>`;
    // Tiny pixel sprites stay inside the computer's existing screen.
    const invader = (x, y, hit = false) => `<g transform="translate(${x} ${y})" ${hit ? 'class="invader-hit"' : ''} fill="#a9d98a" stroke="none">${[
        '00100100', '00011000', '00111100', '01111110',
        '11011011', '11111111', '10100101', '00100100'
    ].map((row, dy) => [...row].map((pixel, dx) => pixel === '1'
        ? `<rect x="${dx * .55}" y="${dy * .55}" width=".55" height=".55"/>` : '').join('')).join('')}</g>`;
    const monitor = (x, i) => `<g transform="translate(${x} 0)">
        ${path('M0 177v15m-10 0h20', 'none', 'stroke-width="3"')}
        ${rect(-23, 143, 46, 34, '#6486a1', 4)}${rect(-19, 147, 38, 25, '#263d59')}
        <g class="screen-work screen-${i}">${rect(-16, 150, 32, 4, '#a9d7e9', 0)}${path('M-13 160H9m-22 5H2', 'none', 'stroke="#a9d7e9" stroke-width="2"')}
            <circle cx="12" cy="166" r="3" fill="#b9dc8b" stroke="none"/></g>
        ${i === 1 ? `<g class="screen-game" shape-rendering="crispEdges">
            <g class="invader-formation">${[151, 157].map((y, row) => [-15, -6, 3, 12].map((x, col) => invader(x, y, row === 1 && col === 2)).join('')).join('')}</g>
            <g class="game-shot" stroke="#ffe3a0" stroke-width=".8"><path d="M0 165v-3"/></g>
            <g class="game-player" fill="#a9d98a" stroke="none"><path d="M-4 170v-2h2v-1h1v-2h2v2h1v1h2v2Z"/></g>
        </g>` : ''}
    </g>`;
    host.innerHTML = `<svg viewBox="-50 0 460 900" xmlns="http://www.w3.org/2000/svg" stroke="#293d52" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">
        <defs>
            <linearGradient id="tower-shaft"><stop stop-color="#b9cbd4"/><stop offset=".3" stop-color="#fffaf0"/><stop offset=".8" stop-color="#fffaf0"/><stop offset="1" stop-color="#c5d4dc"/></linearGradient>
            <linearGradient id="tower-glass" x2="1" y2="1"><stop stop-color="#b1def2"/><stop offset="1" stop-color="#719dbb"/></linearGradient>
            <clipPath id="tower-cabin"><path d="M-25 140H385L347 304H13Z"/></clipPath>
        </defs>
        <g transform="translate(0 0)">
            ${path('M115 354H245L263 824H97Z', 'url(#tower-shaft)', 'stroke-width="4"')}
            ${path('M97 815H263L285 886H75Z', '#e9e5d9', 'stroke-width="4"')}
            ${[430, 540, 650].map(y => rect(170, y, 20, 48, '#83aec8', 6)).join('')}
            ${rect(146, 840, 68, 45, '#779fb7', 4)}${path('M180 842v40')}${rect(140, 825, 80, 13, '#ed8a79', 5)}
            ${rect(68, 881, 224, 12, '#4b6175', 4)}
            ${path('M-25 140H385L347 304H13Z', '#b9dff2', 'stroke-width="4"')}
            <g clip-path="url(#tower-cabin)">
                <g class="tower-interior">
                    ${path('M-30 139H390V168Q180 150-30 168Z', '#93b6ca', 'stroke="none"')}
                    <ellipse cx="180" cy="163" rx="24" ry="5" fill="#fff1cd" stroke-width="2"/>
                    ${path('M-30 285Q180 260 390 285V315H-30Z', '#cdd8d5', 'stroke="none"')}
                    <g class="crew-room" transform="translate(180 94)">
                        ${[65, 180, 295].map(x => `<g transform="translate(${x - 180} 0)">${rect(-20, 130, 36, 43, '#8dabc0', 8)}${path('M0 173v24m-14 0h28')}</g>`).join('')}
                        ${[0, 1, 2].map(crew).join('')}
                        ${path('M-191 174Q0 160 191 174l-3 13Q0 176-188 187Z', '#fff3d8')}
                        ${[-70, 40, 155].map(monitor).join('')}
                        ${path('M-188 187Q0 176 188 187v25H-188Z', '#e3c99e')}
                        <g class="paper-stack" transform="translate(139 183)">${rect(-11, -5, 21, 10, '#e2b274')}${rect(-8, -11, 17, 9, '#fffaf0')}</g>
                        <circle class="tower-ready-light" cx="-175" cy="186" r="5" fill="#d1dadb"/>
                    </g>
                </g>
                <path class="tower-tint" d="M-30 139H390V310H-30Z" fill="url(#tower-glass)" stroke="none"/>
                ${path('M-20 142 85 142 18 299H8Zm170 0h82l-55 162h-64Z', '#ffffff', 'opacity=".15" stroke="none"')}
            </g>
            ${path('M-25 140H385L347 304H13ZM110 143l9 160m131-160-9 160', 'none', 'stroke-width="4"')}
            ${path('M13 306H347L324 344H36Z', '#3e536d', 'stroke-width="4"')}
            ${path('M36 344H324L281 365H79Z', '#35485e', 'stroke-width="4"')}
            ${path('M9 303H351L355 320H5Z', '#ee9380', 'stroke-width="4"')}
            ${rect(-40, 112, 440, 38, '#465a73', 18)}
            ${path('M-31 140Q180 122 391 140v8Q180 132-31 148Z', '#fff3d6', 'stroke-width="2"')}
            ${path('M70 112V31h12v81', '#91b3c6')}${rect(64, 82, 24, 30, '#fffaf0', 5)}
            <circle cx="76" cy="24" r="9" fill="#fffaf0"/>
            ${path('M265 110l7-34 20 34Z', '#80a8c0')}${path('M252 55q32 14 67 20-26 31-67-20Z', '#fffaf0')}${path('M282 64l10-19')}
            <circle cx="294" cy="41" r="3" fill="#fffaf0"/>
        </g>
    </svg>`;
    document.body.append(host);
    // The two top corner radii meet here on the rotated foreground hill.
    // A real anchor inherits the hill's responsive size and rotation.
    const groundAnchor = document.createElement('span');
    groundAnchor.style.cssText = 'position:absolute;left:45.454545%;top:0;width:0;height:0;';
    document.querySelector('.hill-front').append(groundAnchor);
    const select = s => host.querySelector(s);
    const members = [0, 1, 2].map(i => ({
        root: select(`.parcel-${i}`), body: select(`.parcel-${i} .parcel-body`),
        face: select(`.parcel-${i} .parcel-face`), eyes: select(`.parcel-${i} .parcel-eyes`), headset: select(`.parcel-${i} .crew-headset`),
        files: select(`.parcel-${i} .crew-files`), controller: i === 1 ? select(`.parcel-${i} .crew-controller`) : null,
        arms: ['left', 'right'].map(side => select(`.parcel-${i} .arm-${side}`)),
        hands: ['left', 'right'].map(side => select(`.parcel-${i} .hand-${side}`)),
        feet: ['left', 'right'].map(side => select(`.parcel-${i} .foot-${side}`))
    }));
    // Keep the held controller in front of the desk lip so its grips stay visible.
    select('.crew-room').append(members[1].controller);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = x => Math.max(0, Math.min(1, x));
    const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
    const mix = (a, b, p) => a + (b - a) * p;
    let preparation = null, snapshots = [], frame, countdown;
    const origin = performance.now();
    const pose = (i, t) => i === 0
        ? { x: -115 + Math.sin(t * .95) * 35, y: 146 + Math.abs(Math.sin(t * 7)) * 2, angle: Math.sin(t * 7) * 1.5, facing: 1 - 2 * ease((Math.cos(t * .95) + .18) / .36) }
        : { x: i === 1 ? 0 : 110, y: 146 + Math.sin(t * (i === 1 ? 2.2 : 1.4)) * .8, angle: Math.sin(t * (i === 1 ? 1.7 : 1.1)) * (i === 1 ? .8 : 2), facing: 1 };
    function render(now) {
        const t = reduced.matches ? 0 : (now - origin) / 1000;
        const elapsed = preparation === null ? null : (now - preparation) / 1000;
        members.forEach((member, i) => {
            const idle = pose(i, t);
            // The gamer stays seated; sorter and walker finish their current tasks first.
            const arrival = elapsed === null ? 0 : reduced.matches ? 1 : ease((elapsed - [0.15, 0, .25][i]) / [1.55, .15, 1.05][i]);
            const start = snapshots[i] || idle;
            const p = elapsed === null ? idle : { x: mix(start.x, [-115, 0, 115][i], arrival), y: mix(start.y, 146, arrival), angle: mix(start.angle, 0, arrival), facing: mix(start.facing, 1, arrival) };
            const fit = elapsed === null ? 0 : reduced.matches ? 1 : ease((elapsed - [1.65, .22, 1.25][i]) / .7);
            const settle = elapsed === null ? 0 : reduced.matches ? 1 : ease((elapsed - [2.5, .95, 2.15][i]) / .4);
            const signal = !reduced.matches && i === 0 && elapsed !== null ? ease((elapsed - 3) / .3) : 0;
            member.root.setAttribute('transform', `translate(${p.x} ${p.y})`);
            member.body.setAttribute('transform', `rotate(${reduced.matches ? 0 : p.angle}) scale(${reduced.matches ? 1 : p.facing} 1)`);
            member.face.setAttribute('transform', `translate(${i === 0 && !reduced.matches ? -6 * (1 - arrival) : 0} 0)`);
            member.eyes.style.opacity = !reduced.matches && (t + i * 1.3) % 4.3 < .12 ? '.15' : '1';
            member.headset.style.opacity = fit > 0 ? '1' : '0';
            member.headset.setAttribute('transform', `translate(0 ${mix(35, 0, fit)})`);
            if (member.controller) {
                const putDown = elapsed === null ? 0 : reduced.matches ? 1 : ease(elapsed / .2);
                member.controller.style.opacity = `${1 - putDown}`;
                member.controller.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${reduced.matches ? 0 : p.angle}) translate(0 ${putDown * 12 + (reduced.matches ? 0 : Math.sin(t * 3) * .5)}) rotate(${reduced.matches ? 0 : Math.sin(t * 1.7) * 1.5}) rotate(180 0 20)`);
            }
            const paper = i === 2 ? (elapsed === null ? .8 + Math.sin(t * 2) * .15 : 1 - ease((elapsed - .55) / .65)) : 0;
            member.files.style.opacity = `${paper}`;
            member.files.setAttribute('transform', `translate(${Math.sin(t * 1.4) * 3} ${14 + (reduced.matches ? 0 : Math.sin(t * 2.3) * 2)}) rotate(${-paper * 4})`);
            [-1, 1].forEach((side, j) => {
                const walking = i === 0 ? (elapsed === null ? 1 : 1 - arrival) : 0;
                const swing = reduced.matches ? 0 : Math.sin(t * 7 + j * Math.PI);
                let x = side * (i === 0 ? 31 : 15), y = 20 + swing * (i === 0 ? 9 : 2);
                if (i === 1) { x = side * 17; y = 19 + (reduced.matches ? 0 : Math.sin(t * 3 + j) * .5); }
                if (i === 2) { x = side * 12; y = 24 + Math.sin(t * 2 + j) * 2; }
                x = mix(x, side * 28, fit); y = mix(y, -7, fit);
                x = mix(x, side * 15, settle); y = mix(y, 25 + (reduced.matches ? 0 : Math.sin(t * (i === 1 ? 13 : 7) + j) * 1.4), settle);
                if (side === -1) { x = mix(x, -34, signal); y = mix(y, -23, signal); }
                member.arms[j].setAttribute('d', `M${side * 24} 3Q${side * 33} 9 ${x} ${y}`);
                member.hands[j].setAttribute('cx', x); member.hands[j].setAttribute('cy', y);
                member.feet[j].setAttribute('transform', `translate(${swing * walking * 7} ${-Math.max(0, swing) * walking * 3})`);
            });
            select(`.screen-${i}`).style.opacity = i === 1 && (elapsed === null || elapsed < 1.1) ? '0' : '1';
        });
        select('.screen-game').style.opacity = elapsed === null || elapsed < 1.1 ? '1' : '0';
        const shipX = reduced.matches ? 0 : Math.sin(t * 1.9) * 12;
        const shotPhase = reduced.matches ? 0 : (t * 1.6) % 1;
        select('.game-player').setAttribute('transform', `translate(${shipX} 0)`);
        select('.invader-formation').setAttribute('transform', `translate(${reduced.matches ? 0 : Math.sin(t * 1.2) * 2} ${reduced.matches ? 0 : Math.floor((t % 4) / 2)})`);
        select('.game-shot').setAttribute('transform', `translate(${shipX} ${-shotPhase * 13})`);
        select('.invader-hit').style.opacity = shotPhase > .8 ? '0' : '1';
        select('.tower-ready-light').setAttribute('fill', elapsed !== null && elapsed >= 3.25 ? '#a9cd8b' : elapsed !== null ? '#f4cd7e' : '#d1dadb');
        if (elapsed !== null && !countdown) countdown = document.querySelector('.warmup-countdown');
        if (countdown && elapsed !== null) countdown.textContent = Math.max(1, 5 - Math.floor(elapsed));
        if (!document.body.classList.contains('has-entered')) frame = requestAnimationFrame(render);
    }
    function layout() {
        // Reserve actual viewport space for the cabin; text height must never
        // push it below the bottom edge in a split pane or during connection.
        const narrow = innerWidth < 720 && innerHeight >= innerWidth;
        const welcome = document.querySelector('.welcome');
        let width, x, y;
        welcome.style.maxHeight = 'none';
        if (narrow) {
            welcome.style.left = '50%';
            welcome.style.transform = 'translateX(-50%)';
            welcome.style.width = '';
            welcome.style.top = `${innerHeight * .26}px`;
            // Measure the complete form instead of hiding text in a scroll box.
            // Reserve space for the Cancel button before connection begins.
            const reserve = document.getElementById('welcome-reload').hidden ? 36 : 0;
            const room = Math.max(40, innerHeight - welcome.getBoundingClientRect().bottom - reserve - 24);
            width = Math.min(360, innerWidth * .9, room * 460 / 325);
            x = innerWidth - width - 10;
            y = innerHeight - width * 325 / 460 - 12;
        } else {
            width = Math.min(560, innerWidth * .5, innerHeight * 1.05);
            x = innerWidth - width - innerWidth * .025;
            y = Math.min(innerHeight * .39, innerHeight - width * 325 / 460 - 12);
            const formWidth = Math.min(456, x - 44);
            welcome.style.width = `${formWidth}px`;
            welcome.style.left = `${Math.min((innerWidth - formWidth) / 2, x - formWidth - 20)}px`;
            welcome.style.transform = 'none';
            welcome.style.top = innerHeight < 500 ? `${innerHeight * .27}px` : '';
        }
        const scenery = document.querySelector('.scenery');
        const ground = groundAnchor.getBoundingClientRect();
        const world = scenery.getBoundingClientRect();
        const finalWidth = Math.min(112, innerWidth * .22, innerHeight * .2);
        const scale = finalWidth / width;
        // Express the hill crest in the final camera view, regardless of the
        // current sky transform. Sink the foot five pixels into the grass.
        const baseY = ground.top - world.top - innerHeight + 5;
        const finalX = ground.left - world.left - finalWidth / 2;
        const finalY = baseY - finalWidth * 893 / 460;
        host.style.cssText = `width:${width}px;left:${x}px;top:${y}px;--tower-x:${finalX - x}px;--tower-y:${finalY - y}px;--tower-scale:${scale};`;
    }
    window.addEventListener('resize', layout);
    new ResizeObserver(layout).observe(document.querySelector('.welcome'));
    window.addEventListener('discovery-warmup-start', () => {
        preparation = performance.now();
        snapshots = members.map((_, i) => pose(i, reduced.matches ? 0 : (preparation - origin) / 1000));
        countdown = document.querySelector('.warmup-countdown');
    });
    const reset = () => { preparation = null; snapshots = []; countdown = null; };
    window.addEventListener('discovery-warmup-error', reset);
    window.addEventListener('discovery-error', reset);
    window.addEventListener('pagehide', () => cancelAnimationFrame(frame));
    window.addEventListener('pageshow', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); });
    layout();
    frame = requestAnimationFrame(render);
})();
