// --------------------------------------------------------
// 1. Scene & Camera Setup
// --------------------------------------------------------
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 8000);
camera.position.z = 10; // Morning stable Z position

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// ACES filmic tonemapping + reduced exposure for cinematic, lower-brightness Earth
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72; // <1 = darker/more cinematic
container.appendChild(renderer.domElement);



// --------------------------------------------------------
// Determine Day / Night mode from IST
// --------------------------------------------------------
function getISTHour() {
    const d = new Date();
    const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
    const istMs = utcMs + (3600000 * 5.5);
    return new Date(istMs).getHours();
}
const istHour = getISTHour();
// Day = 6 AM – 7 PM  |  Night = 7 PM – 6 AM
const IS_DAY = istHour >= 6 && istHour < 19;
console.log(`Globe mode: ${IS_DAY ? 'DAY ☀️' : 'NIGHT 🌙'}  (IST ${istHour}:xx)`);

// Loading Manager for Reliability
const loadingManager = new THREE.LoadingManager();
loadingManager.onStart = (url, itemsLoaded, itemsTotal) => console.log(`Started loading: ${url}`);
loadingManager.onLoad = () => console.log('All textures loaded successfully!');
loadingManager.onError = (url) => console.error(`Error loading texture: ${url}. Fallback colors will be used.`);

const textureLoader = new THREE.TextureLoader(loadingManager);

// Helper for Round Stars (fixes square boxes)
function createCircleTexture(color = '#ffffff', size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}
const starTexture = createCircleTexture();

// Fluid Physic Trackers
const raycaster = new THREE.Raycaster();
const cursorVector = new THREE.Vector2();
const targetPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const intersectPoint = new THREE.Vector3();

// ============================================================
// GALAXY SKYBOX — procedural canvas background sphere
// ============================================================
function createGalaxyBackground() {
    const W = 4096, H = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 1. Deep space base
    ctx.fillStyle = '#00000a';
    ctx.fillRect(0, 0, W, H);

    // 2. Large nebula cloud blobs
    const nebulas = [
        { cx: W*0.25, cy: H*0.35, rx: W*0.30, ry: H*0.45, r: 0, g: 20, b: 90, a: 0.22 },
        { cx: W*0.75, cy: H*0.60, rx: W*0.28, ry: H*0.40, r: 80, g: 0,  b: 120, a: 0.20 },
        { cx: W*0.50, cy: H*0.20, rx: W*0.25, ry: H*0.35, r: 120, g: 40, b: 0,  a: 0.15 },
        { cx: W*0.85, cy: H*0.30, rx: W*0.20, ry: H*0.30, r: 0,  g: 80, b: 100, a: 0.18 },
        { cx: W*0.15, cy: H*0.75, rx: W*0.22, ry: H*0.28, r: 60, g: 0,  b: 100, a: 0.15 },
    ];
    nebulas.forEach(n => {
        const grd = ctx.createRadialGradient(n.cx, n.cy, 0, n.cx, n.cy, Math.max(n.rx, n.ry));
        grd.addColorStop(0,   `rgba(${n.r},${n.g},${n.b},${n.a})`);
        grd.addColorStop(0.5, `rgba(${n.r},${n.g},${n.b},${n.a * 0.4})`);
        grd.addColorStop(1,   `rgba(0,0,0,0)`);
        ctx.fillStyle = grd;
        ctx.save();
        ctx.translate(n.cx, n.cy);
        ctx.scale(n.rx / Math.max(n.rx, n.ry), n.ry / Math.max(n.rx, n.ry));
        ctx.translate(-n.cx, -n.cy);
        ctx.beginPath();
        ctx.arc(n.cx, n.cy, Math.max(n.rx, n.ry), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // 3. Galactic core — bright warm centre
    const core = ctx.createRadialGradient(W*0.5, H*0.5, 0, W*0.5, H*0.5, H*0.30);
    core.addColorStop(0,    'rgba(255,245,200,0.95)');
    core.addColorStop(0.08, 'rgba(240,200,255,0.75)');
    core.addColorStop(0.20, 'rgba(140,80,255,0.35)');
    core.addColorStop(0.45, 'rgba(60,30,140,0.15)');
    core.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, W, H);

    // 4. Spiral arm sweeps (two arms, low-opacity gradient arcs)
    function drawArm(startAngle, color) {
        ctx.save();
        ctx.translate(W * 0.5, H * 0.5);
        for (let r = 60; r < H * 0.48; r += 2) {
            const angle = startAngle + (r / (H * 0.48)) * Math.PI * 1.8;
            const x = Math.cos(angle) * r * (W / H);
            const y = Math.sin(angle) * r;
            const alpha = Math.max(0, 0.12 - r / (H * 4));
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${color},${alpha})`;
            ctx.fill();
        }
        ctx.restore();
    }
    drawArm(0.3,   '180,140,255');  // purple arm
    drawArm(0.3 + Math.PI, '100,180,255'); // blue opposite arm

    // 5. Dense star field baked into texture - With GLOW
    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const distC = Math.hypot(x - W*0.5, y - H*0.5) / (H * 0.5);
        if (Math.random() > (1 - 0.7 * (1 - distC))) continue;
        
        const size  = Math.random() * 1.5 + 0.4;
        const bright = 0.5 + Math.random() * 0.5;
        const hue = Math.random();
        let colorStr = '255,255,255';
        if (hue > 0.75) colorStr = '255,230,180'; // warm
        else if (hue > 0.5) colorStr = '200,220,255'; // cool
        
        // Add glow for larger stars
        if (size > 1.2) {
            const glowGrd = ctx.createRadialGradient(x, y, 0, x, y, size * 4);
            glowGrd.addColorStop(0, `rgba(${colorStr},${bright * 0.3})`);
            glowGrd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glowGrd;
            ctx.beginPath();
            ctx.arc(x, y, size * 4, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorStr},${bright})`;
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(900, 64, 32),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false })
    );
    return sky;
}
const galaxySky = createGalaxyBackground();
scene.add(galaxySky);

// ============================================================
// 2. Space Environment — fluid + static star layers
// ============================================================
let interactableStars,  baseStarPositions,  starCount;
let interactableStars2, baseStarPositions2, starCount2; // coloured fluid layer
let meteors, meteorCount, meteorVel;

function createSpace() {
    const spaceGroup = new THREE.Group();

    // ── A. PRIMARY Fluid Stars (white/silver) - DENSE ──
    starCount = 22000;
    const sv = new Float32Array(starCount * 3);
    baseStarPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
        const val = (Math.random() - 0.5) * 80;
        sv[i] = val; baseStarPositions[i] = val;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sv, 3));
    sGeo.setAttribute('basePosition', new THREE.BufferAttribute(baseStarPositions.slice(), 3));
    interactableStars = new THREE.Points(sGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 0.15, transparent: true, opacity: 0.9,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    spaceGroup.add(interactableStars);

    // ── B. SECONDARY Fluid Stars (purple/blue) - DENSE ──
    starCount2 = 12000;
    const sv2 = new Float32Array(starCount2 * 3);
    baseStarPositions2 = new Float32Array(starCount2 * 3);
    for (let i = 0; i < starCount2 * 3; i++) {
        const val = (Math.random() - 0.5) * 90;
        sv2[i] = val; baseStarPositions2[i] = val;
    }
    const sGeo2 = new THREE.BufferGeometry();
    sGeo2.setAttribute('position', new THREE.BufferAttribute(sv2, 3));
    interactableStars2 = new THREE.Points(sGeo2, new THREE.PointsMaterial({
        color: 0xcc99ff, size: 0.12, transparent: true, opacity: 0.8,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    spaceGroup.add(interactableStars2);

    // ── C. Far ultra-deep background - REDUCED ──
    const fv = new Float32Array(5000 * 3);
    for (let i = 0; i < fv.length; i++) fv[i] = (Math.random() - 0.5) * 300;
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    spaceGroup.add(new THREE.Points(fGeo, new THREE.PointsMaterial({
        color: 0xc8deff, size: 0.06, transparent: true, opacity: 0.45,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    })));

    // ── D. Milky Way golden band - REDUCED ──
    const gv = new Float32Array(2000 * 3);
    for (let i = 0; i < 2000; i++) {
        gv[i*3]   = (Math.random() - 0.5) * 160;
        gv[i*3+1] = (Math.random() - 0.5) * 18;   // thin equatorial band
        gv[i*3+2] = (Math.random() - 0.5) * 160;
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(gv, 3));
    spaceGroup.add(new THREE.Points(gGeo, new THREE.PointsMaterial({
        color: 0xffeedd, size: 0.055, transparent: true, opacity: 0.40,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    })));

    // ── E. Purple nebula particle cloud ──
    const pv = new Float32Array(4000 * 3);
    for (let i = 0; i < 4000; i++) {
        // Concentrated blob offset to upper-left
        pv[i*3]   = -15 + (Math.random() - 0.5) * 50;
        pv[i*3+1] =  10 + (Math.random() - 0.5) * 30;
        pv[i*3+2] = -20 + (Math.random() - 0.5) * 50;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pv, 3));
    spaceGroup.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
        color: 0x8833ff, size: 0.25, transparent: true, opacity: 0.12,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    })));

    // ── F. Blue nebula cloud (lower-right) ──
    const bv = new Float32Array(4000 * 3);
    for (let i = 0; i < 4000; i++) {
        bv[i*3]   =  20 + (Math.random() - 0.5) * 55;
        bv[i*3+1] = -12 + (Math.random() - 0.5) * 30;
        bv[i*3+2] = -15 + (Math.random() - 0.5) * 50;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    spaceGroup.add(new THREE.Points(bGeo, new THREE.PointsMaterial({
        color: 0x2266ff, size: 0.22, transparent: true, opacity: 0.10,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    })));

    // ── G. Meteors ──
    meteorCount = 15;
    const meteorVertices = new Float32Array(meteorCount * 3);
    meteorVel = new Float32Array(meteorCount * 3);
    for (let i = 0; i < meteorCount; i++) {
        meteorVertices[i*3]   = (Math.random() - 0.5) * 50;
        meteorVertices[i*3+1] = 10 + Math.random() * 20;
        meteorVertices[i*3+2] = (Math.random() - 0.5) * 10;
        meteorVel[i*3]   = -0.02 - Math.random() * 0.08;
        meteorVel[i*3+1] = -0.15 - Math.random() * 0.3;
    }
    const meteorGeo = new THREE.BufferGeometry();
    meteorGeo.setAttribute('position', new THREE.BufferAttribute(meteorVertices, 3));
    meteors = new THREE.Points(meteorGeo, new THREE.PointsMaterial({
        color: 0xaaccff, size: 0.22, transparent: true, opacity: 1.0,
        map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    spaceGroup.add(meteors);

    // ── H. Distant Planets ──
    function addPlanet(radius, mapUrl, x, y, z) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 32, 32),
            new THREE.MeshPhongMaterial({ map: textureLoader.load(mapUrl) })
        );
        mesh.position.set(x, y, z);
        spaceGroup.add(mesh);
    }
    addPlanet(0.6, 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/mars_1k_color.jpg',  -120, 30, -200);
    addPlanet(2.5, 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/jupiter.jpg', 200, -50, -300);

    return spaceGroup;
}
const spaceEnv = createSpace();
scene.add(spaceEnv);


// 3. Earth & Clouds
const isMobileDevice = window.innerWidth < 768;
// FORCED DESKTOP CONSTANTS FOR ALL DEVICES
const globeBaseScale = 1.0;
const globeZoomScale = 2.8;
const globeZoomPosY = -6.2;
const globeGroup = new THREE.Group();

// --- Touch Handling for forced desktop layout on mobile ---
let touchStartY = 0;
window.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (e) => {
    if (isAnimating) return;
    const touchY = e.touches[0].clientY;
    const diffY = touchStartY - touchY;
    if (Math.abs(diffY) > 2) {
        // Map touch movement to scroll progress
        scrollProgress = Math.min(1, Math.max(0, scrollProgress + diffY * 0.003));
        updateVisuals();
    }
    touchStartY = touchY;
}, { passive: true });

globeGroup.scale.set(globeBaseScale, globeBaseScale, globeBaseScale);
globeGroup.position.set(0, 0, 0); // Start at center for everyone
scene.add(globeGroup);

// Asia is roughly at longitude ~80°E which maps to ~0.22 of a full rotation from center
// Three.js sphere seam is at 0 lon on left edge; +rotation.y turns CCW from front
// To bring Asia (80°E) to front: rotation.y = -PI * (80/180) ≈ -1.396 but our textures use
// a different convention. Empirically ~2.2 radians brings India/Asia to center.
const ASIA_ROTATION_Y = 2.2;

// ---- REALISTIC Earth Material ----
// High-res NASA textures for maximum realism
const EARTH_DAY_MAP   = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const EARTH_NIGHT_MAP = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
const EARTH_BUMP_MAP  = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const EARTH_SPEC_MAP  = 'https://unpkg.com/three-globe/example/img/earth-water.png'; // ocean specularity
const CLOUD_MAP       = 'https://unpkg.com/three-globe/example/img/clouds.png';

let earthMat;
if (IS_DAY) {
    // ☀️ DAY: PBR realistic with specular oceans
    earthMat = new THREE.MeshStandardMaterial({
        map:          textureLoader.load(EARTH_DAY_MAP),
        bumpMap:      textureLoader.load(EARTH_BUMP_MAP),
        bumpScale:    0.12,
        roughnessMap: textureLoader.load(EARTH_SPEC_MAP), // light blue = ocean = low roughness
        roughness:    0.65,
        metalness:    0.08,
        // Slight warm emissive so unlit side isn't pitch black
        emissive:          new THREE.Color(0x001122),
        emissiveIntensity: 0.18
    });
} else {
    // 🌙 NIGHT: Dark with glowing city-lights emissive
    earthMat = new THREE.MeshStandardMaterial({
        map:              textureLoader.load(EARTH_DAY_MAP),
        bumpMap:          textureLoader.load(EARTH_BUMP_MAP),
        bumpScale:        0.08,
        roughnessMap:     textureLoader.load(EARTH_SPEC_MAP),
        roughness:        0.85,
        metalness:        0.1,
        emissiveMap:      textureLoader.load(EARTH_NIGHT_MAP),
        emissive:         new THREE.Color(0xffeeaa),
        emissiveIntensity: 1.6
    });
}

// Higher geometry resolution for a smoother globe
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(2, 96, 96), earthMat);
earthMesh.rotation.y = ASIA_ROTATION_Y;
earthMesh.rotation.x = 0.32;
globeGroup.rotation.x = 0.32;
globeGroup.add(earthMesh);

// ---- Realistic Cloud Layer ----
const cloudMat = new THREE.MeshStandardMaterial({
    alphaMap:    textureLoader.load(CLOUD_MAP),
    transparent: true,
    opacity:     IS_DAY ? 0.92 : 0.45,
    color:       0xffffff,
    roughness:   1.0,
    metalness:   0.0,
    depthWrite:  false
});
const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(2.04, 96, 96), cloudMat);
globeGroup.add(cloudMesh);

// Second, slightly offset cloud layer for depth & thickness
const cloudMat2 = new THREE.MeshStandardMaterial({
    alphaMap:    textureLoader.load(CLOUD_MAP),
    transparent: true,
    opacity:     IS_DAY ? 0.45 : 0.2,
    color:       0xddeeff,
    roughness:   1.0,
    metalness:   0.0,
    depthWrite:  false
});
const cloudMesh2 = new THREE.Mesh(new THREE.SphereGeometry(2.07, 96, 96), cloudMat2);
globeGroup.add(cloudMesh2);

// ---- Fresnel Atmospheric Glow (custom ShaderMaterial) ----
// This simulates the real thin-atmosphere limb glow seen from space
const atmosShader = {
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
            vNormal  = normalize(normalMatrix * normal);
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
        }
    `,
    fragmentShader: `
        uniform vec3  glowColor;
        uniform float fresnelPower;
        uniform float opacity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
            float fresnel = pow(1.0 - abs(dot(vNormal, vViewDir)), fresnelPower);
            gl_FragColor  = vec4(glowColor, fresnel * opacity);
        }
    `
};

const atmosMat = new THREE.ShaderMaterial({
    uniforms: {
        glowColor:    { value: new THREE.Color(IS_DAY ? 0x4fc3f7 : 0x0d47a1) },
        fresnelPower: { value: IS_DAY ? 3.5 : 4.5 },
        opacity:      { value: IS_DAY ? 1.0 : 0.85 }
    },
    vertexShader:   atmosShader.vertexShader,
    fragmentShader: atmosShader.fragmentShader,
    transparent: true,
    side:        THREE.FrontSide,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false
});
const atmosMesh = new THREE.Mesh(new THREE.SphereGeometry(2.18, 64, 64), atmosMat);
globeGroup.add(atmosMesh);

// Outer halo — thicker outer atmosphere ring
const haloMat = new THREE.ShaderMaterial({
    uniforms: {
        glowColor:    { value: new THREE.Color(IS_DAY ? 0x90caf9 : 0x1565c0) },
        fresnelPower: { value: IS_DAY ? 5.5 : 7.0 },
        opacity:      { value: IS_DAY ? 0.55 : 0.35 }
    },
    vertexShader:   atmosShader.vertexShader,
    fragmentShader: atmosShader.fragmentShader,
    transparent: true,
    side:        THREE.BackSide,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false
});
const haloMesh = new THREE.Mesh(new THREE.SphereGeometry(2.38, 64, 64), haloMat);
globeGroup.add(haloMesh);

// ============================================================
// 🌐 BLOCKCHAIN CITY NETWORK / SATELLITE MESH (Night Mode Only)
// ============================================================
let blockchainNetwork = null;

function latLonToVec3(lat, lon, radius) {
    const phi   = (90 - lat)  * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
         radius * Math.cos(phi),
         radius * Math.sin(phi) * Math.sin(theta)
    );
}

if (!IS_DAY) {
    const NET_R = 2.025; // just above Earth surface
    const networkGroup = new THREE.Group();

    // ── MAJOR CITY NODES (~45 nodes like before) ──
    const MAJOR_CITIES = [
        // India & South Asia
        [28.6,  77.2 ], [19.0,  72.8 ], [12.9,  77.6 ], [13.1,  80.3 ],
        [22.5,  88.4 ], [23.7,  90.4 ], [17.4,  78.5 ], [23.0,  72.6 ],
        [26.9,  75.8 ], [31.5,  74.3 ], [33.7,  73.1 ], [27.7,  85.3 ],
        [6.9,   79.8 ],
        // Southeast Asia
        [1.35,  103.8], [3.15,  101.7], [13.8,  100.5], [21.0,  105.8],
        [10.8,  106.7], [14.6,  121.0], [22.3,  114.2],
        // East Asia
        [31.2,  121.5], [39.9,  116.4], [37.6,  127.0], [35.7,  139.7],
        [34.7,  135.5],
        // Central & West Asia
        [25.2,  55.3 ], [24.7,  46.7 ], [41.0,  29.0 ], [55.8,  37.6 ],
        // Europe
        [51.5,  -0.1 ], [48.9,  2.35 ], [52.5,  13.4 ], [41.4,  2.17 ],
        // Africa
        [30.1,  31.2 ], [-1.3,  36.8 ], [-26.2, 28.0 ], [-33.9, 18.4 ],
        // Americas
        [40.7,  -74.0 ], [34.0,  -118.2], [43.7,  -79.4 ], [-23.5, -46.6 ],
        [-34.6, -58.4 ],
        // Oceania
        [-33.9, 151.2], [-37.8, 144.9]
    ];

    // ── GLOW SPRITES ──
    function makeWhiteSprite(size, bright) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const cx = size / 2;
        const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
        if (bright) {
            g.addColorStop(0,   'rgba(255,230,160,1.0)'); // warm golden core
            g.addColorStop(0.2, 'rgba(255,200,100,0.9)');
            g.addColorStop(0.5, 'rgba(200,230,255,0.5)');
            g.addColorStop(1,   'rgba(100,180,255,0.0)');
        } else {
            g.addColorStop(0,   'rgba(220,240,255,1.0)'); // cool white
            g.addColorStop(0.3, 'rgba(180,220,255,0.7)');
            g.addColorStop(1,   'rgba(100,160,255,0.0)');
        }
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(c);
    }
    const majorTex = makeWhiteSprite(64, true);

    const nodeSprites = [];
    const allPositions = MAJOR_CITIES.map(([lat, lon]) => latLonToVec3(lat, lon, NET_R));

    allPositions.forEach((pos, i) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: majorTex,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            opacity: 1.0
        }));
        sprite.position.copy(pos);
        
        // India-region hubs are slightly larger
        const isIndia = MAJOR_CITIES[i][1] > 68 && MAJOR_CITIES[i][1] < 90 && MAJOR_CITIES[i][0] > 8 && MAJOR_CITIES[i][0] < 36;
        sprite.scale.setScalar(isIndia ? 0.16 : 0.10);
        
        sprite.userData.baseScale = sprite.scale.x;
        sprite.userData.phase = Math.random() * Math.PI * 2;
        networkGroup.add(sprite);
        nodeSprites.push(sprite);
    });

    // ── MESH CONNECTIONS ──
    const MESH_DIST = 3.5; 
    const MESH_CONN = 5;
    allPositions.forEach((posA, i) => {
        const sorted = allPositions
            .map((posB, j) => ({ j, dist: posA.distanceTo(posB) }))
            .filter(({ j, dist }) => j !== i && dist < MESH_DIST)
            .sort((a, b) => a.dist - b.dist)
            .slice(0, MESH_CONN);
        sorted.forEach(({ j }) => {
            if (j > i) {
                // Straight line segment
                const geo = new THREE.BufferGeometry().setFromPoints([posA, allPositions[j]]);
                const mat = new THREE.LineBasicMaterial({
                    color: 0x44aaff,
                    transparent: true,
                    opacity: 0.35,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                });
                networkGroup.add(new THREE.Line(geo, mat));
            }
        });
    });

    // ── HIGHLIGHTED ROUTES (orange/amber arcs) ──
    const ROUTES = [
        // India hub routes
        [[28.6,  77.2], [35.7, 139.7], 0xff8800, 0.95], // Delhi → Tokyo
        [[28.6,  77.2], [51.5,  -0.1], 0xff6600, 0.90], // Delhi → London
        [[28.6,  77.2], [40.7, -74.0], 0xff5500, 0.85], // Delhi → New York
        [[28.6,  77.2], [25.2,  55.3], 0xffaa00, 0.90], // Delhi → Dubai
        [[28.6,  77.2], [-33.9,151.2], 0xff7700, 0.80], // Delhi → Sydney
        [[28.6,  77.2], [-23.5,-46.6], 0xff6600, 0.75], // Delhi → São Paulo
        // Trans-Pacific / Trans-Atlantic
        [[35.7, 139.7], [34.0,-118.2], 0xff9900, 0.80], // Tokyo → LA
        [[51.5,  -0.1], [40.7, -74.0], 0xff7700, 0.80], // London → NY
        [[40.7, -74.0], [-23.5,-46.6], 0xff6600, 0.75], // NY → São Paulo
        [[-26.2, 28.0], [25.2,  55.3], 0xffaa00, 0.70], // Jo'burg → Dubai
    ];
    ROUTES.forEach(([[lat1,lon1],[lat2,lon2], color, opacity]) => {
        const v1 = latLonToVec3(lat1, lon1, NET_R);
        const v2 = latLonToVec3(lat2, lon2, NET_R);
        const dist = v1.distanceTo(v2);
        const liftH = NET_R + 0.12 + dist * 0.08;
        const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize().multiplyScalar(liftH);
        const curve = new THREE.QuadraticBezierCurve3(v1, mid, v2);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color, transparent: true, opacity,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        networkGroup.add(line);
    });

    // ── ANIMATED DATA PACKETS ──
    const packetCount = 60; // Less number
    const packetArr   = new Float32Array(packetCount * 3);
    const packetGeo   = new THREE.BufferGeometry();
    packetGeo.setAttribute('position', new THREE.BufferAttribute(packetArr, 3));
    const packetMat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.038,
        transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const packets = new THREE.Points(packetGeo, packetMat);
    networkGroup.add(packets);

    const packetCurves = ROUTES.map(([[lat1,lon1],[lat2,lon2]]) => {
        const v1 = latLonToVec3(lat1, lon1, NET_R);
        const v2 = latLonToVec3(lat2, lon2, NET_R);
        const dist = v1.distanceTo(v2);
        const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize().multiplyScalar(NET_R + 0.12 + dist * 0.08);
        return new THREE.QuadraticBezierCurve3(v1, mid, v2);
    });
    
    while (packetCurves.length < packetCount) {
        const ai = Math.floor(Math.random() * allPositions.length);
        let   bi = ai; while (bi === ai) bi = Math.floor(Math.random() * allPositions.length);
        const v1 = allPositions[ai], v2 = allPositions[bi];
        const mid = v1.clone().add(v2).multiplyScalar(0.5).normalize().multiplyScalar(NET_R + 0.12);
        packetCurves.push(new THREE.QuadraticBezierCurve3(v1, mid, v2));
    }
    const packetRoutes = Array.from({ length: packetCount }, (_, k) => ({
        curve: packetCurves[k % packetCurves.length],
        t:     Math.random(),
        speed: 0.003 + Math.random() * 0.007
    }));

    blockchainNetwork = { networkGroup, packets, packetRoutes, nodeSprites };

    // Attach to earthMesh so it co-rotates
    earthMesh.add(networkGroup);
    networkGroup.rotation.y = -ASIA_ROTATION_Y;
}

// Orbiting Text Ring
function createOrbitText() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const phrase = " DESIGN YOUR FUTURE HERE - DESIGN YOUR FUTURE -";
    ctx.font = 'bold 70px "Space Grotesk", sans-serif';
    const textWidth = ctx.measureText(phrase).width + 20; // Ensure no clipping
    
    // Scale canvas exactly to text bounds
    canvas.width = textWidth;
    canvas.height = 150;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 70px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#ffffff'; // Flat crisp white
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw text cleanly once without any neon stacking or shadows
    ctx.fillText(phrase, canvas.width / 2, canvas.height / 2); 
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.set(4, 1); // Wrap the string 4 times to scale the text horizon down
    
    const material = new THREE.MeshBasicMaterial({ 
        map: texture, 
        transparent: true, 
        side: THREE.DoubleSide, // Ensure it's readable when it orbits behind the earth too
        depthWrite: false
    });
    
    // Halved the height parameter to squish the mapped radius down, shrinking the font size proportionally
    const geometry = new THREE.CylinderGeometry(2.5, 2.5, 0.25, 64, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    
    // Stylish angled orbital ring tilt
    mesh.rotation.x = 0.35;
    mesh.rotation.z = -0.15;
    
    return mesh;
}
const orbitText = createOrbitText();
globeGroup.add(orbitText);

// 4. Moon — enhanced realism with emissive glow
const moonMat = new THREE.MeshStandardMaterial({
    map:          textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg'),
    bumpMap:      textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/moon_1024.jpg'),
    bumpScale:    0.08,
    roughness:    0.9,
    metalness:    0.0,
    color:        0xffffff,
    emissive:     new THREE.Color(0x222222), // Subtle self-glow for visibility
    emissiveIntensity: 0.2
});
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 64, 64), moonMat);
// Enhanced rim glow light that follows the moon
const moonGlow = new THREE.PointLight(0xffffff, 0.8, 10);
moonMesh.add(moonGlow); 
globeGroup.add(moonMesh);

// 5. Realistic Lighting
// Night: almost zero ambient so city-lights pop. Day: warm sun + sky scatter.
const ambientIntensity = IS_DAY ? 0.35 : 0.015;
scene.add(new THREE.AmbientLight(0xc8d8ff, ambientIntensity));

// Primary Sun — warm, high-intensity directional
const sunLight = new THREE.DirectionalLight(
    IS_DAY ? 0xfff4d6 : 0xeef0ff,
    IS_DAY ? 8.0 : 3.5
);

function setCelestialBodiesByIST() {
    const d = new Date();
    const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
    const istMs = utcMs + (3600000 * 5.5);
    const istDate = new Date(istMs);
    const hours   = istDate.getHours();
    const minutes = istDate.getMinutes();
    const seconds = istDate.getSeconds();
    const timeOffset = (hours + minutes / 60 + seconds / 3600) / 24;
    const sunAngle  = (0.5 - timeOffset) * Math.PI * 2;
    const sunDist   = 50;
    sunLight.position.set(
        Math.sin(sunAngle) * sunDist,
        IS_DAY ? 18 : 6,
        Math.cos(sunAngle) * sunDist
    );
    moonMesh.material.opacity    = 1.0; // Always solid
    moonMesh.material.transparent = false;
}
setCelestialBodiesByIST();
setInterval(setCelestialBodiesByIST, 60000);
scene.add(sunLight);

// Very dim camera-follow light so the dark side is faintly visible (not pitch black)
const cameraLight = new THREE.PointLight(0x223344, IS_DAY ? 0.6 : 0.3, 100);
scene.add(cameraLight);

if (IS_DAY) {
    // Rayleigh-scatter fill — blue sky light from opposite side
    const skyFill = new THREE.DirectionalLight(0x7ab3e0, 2.2);
    skyFill.position.set(-8, -12, 6);
    scene.add(skyFill);
    // Warm rim / backlight to define the terminator line
    const rimLight = new THREE.PointLight(0xffcc88, 3.5, 40);
    rimLight.position.set(10, 6, -10);
    scene.add(rimLight);
} else {
    // Cold deep-space fill for night hemisphere
    const blueLight = new THREE.PointLight(0x0a1a3f, 0.8, 60);
    blueLight.position.set(-12, -6, -12);
    scene.add(blueLight);
}

// 6. Interaction & Animation
let mouseX = 0, mouseY = 0;

document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
});

// 7. Dynamic Glow Tracking for Cards & Nav
const trackingElements = document.querySelectorAll('.glass-card, .glass-nav-pill');
trackingElements.forEach(el => {
    el.addEventListener('mousemove', e => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        el.style.setProperty('--mouse-x', `${x}px`);
        el.style.setProperty('--mouse-y', `${y}px`);
    });
    // Reset glow to center when mouse leaves
    el.addEventListener('mouseleave', () => {
        el.style.setProperty('--mouse-x', `50%`);
        el.style.setProperty('--mouse-y', `50%`);
    });
    
    // Add 3D lift on hover — keep z-index stable so cards never disappear
    if(el.classList.contains('glass-card')) {
        el.addEventListener('mouseenter', () => {
             gsap.to(el, { scale: 1.04, z: 40, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
        });
        el.addEventListener('mouseleave', () => {
             gsap.to(el, { scale: 1, z: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
        });
        // Allow anchor cards to navigate on click without event being swallowed
        if (el.tagName === 'A') {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
});

// Cards start buried deep behind the Earth (large negative z = behind the globe)
// They will fly forward through the Earth surface and land in front of the viewer
gsap.set('.glass-card', {
    rotationZ: 0,
    z: -800,
    x: 0,
    y: 0,
    opacity: 0,
    scale: 0.4
});

// Cinematic Zoom + Card-Emerge Timeline
const tl = gsap.timeline({ paused: true });
tl
  .to(globeGroup.scale,    { x: globeZoomScale, y: globeZoomScale, z: globeZoomScale, ease: 'power2.inOut', duration: 2.2 }, 0)
  .to(globeGroup.position, { y: globeZoomPosY,  ease: 'power2.inOut', duration: 2.2 }, 0)
  .to(globeGroup.rotation, { x: 0.05, ease: 'power2.inOut', duration: 2.2 }, 0)
  .to(spaceEnv.scale,      { x: 1.15, y: 1.15, z: 1.15, duration: 2.2 }, 0)
  .to('.cards-section', { autoAlpha: 1, pointerEvents: 'auto', duration: 0.3 }, 1.4)
  .to('.glass-card', {
      z:        0,
      y:        0,
      scale:    1,
      opacity:  1,
      stagger:  0.12,
      duration: 1.1,
      ease:     'power3.out'
  }, 1.5);

const clock = new THREE.Clock();
let scrollProgress = 0;

if (window.location.hash === '#explore' || window.location.hash === '#cards-section') {
    scrollProgress = 1.0;
    
    requestAnimationFrame(() => {
        // Force absolute progress immediately
        if (typeof tl !== 'undefined') {
            tl.progress(1.0);
            document.querySelector('.progress-bar').style.setProperty('width', '100%');
            updateMainNav(1);
            
            // Critical: Force a render frame immediately
            renderer.render(scene, camera);
        }
        
        // Clean the hash from the URL
        history.replaceState(null, '', window.location.pathname);
    });
}

window.addEventListener('wheel', (e) => {
    // If the user is on the After 10th page, do nothing with scroll progress
    const after10thPage = document.getElementById('after-10th-page');
    if (after10thPage && after10thPage.classList.contains('active')) {
        return;
    }

    scrollProgress += e.deltaY * 0.0005;
    scrollProgress = Math.max(0, Math.min(scrollProgress, 1));
    gsap.to(tl, { progress: scrollProgress, duration: 1.2, ease: "power3.out" });
    // Update progress bar
    document.querySelector('.progress-bar').style.setProperty('width', (scrollProgress * 100) + '%');
    
    // Update Active Nav Link
    const navItems = document.querySelectorAll('.main-header .nav-item');
    const mobNavItems = document.querySelectorAll('.mobile-bottom-nav .mb-nav-item');
    let activeIndex = 0;
    if (scrollProgress < 0.2) activeIndex = 0;      // Home
    else if (scrollProgress < 0.8) activeIndex = 1; // Explore (Zooming/Revealing)
    else activeIndex = 1;                           // Keep Explore as active when fully zoomed

    navItems.forEach((item, index) => {
        if (index === activeIndex) item.classList.add('active');
        else item.classList.remove('active');
    });
    mobNavItems.forEach((item, index) => {
        if (index === activeIndex) item.classList.add('active');
        else item.classList.remove('active');
    });
});

// 7. Click-to-Scroll Navigation & Page Switching
const mainHeader = document.querySelector('.main-header');
const mainNavItems = document.querySelectorAll('.main-header .nav-item');
const aboutPage = document.getElementById('about-page');
let aboutPageOpen = false;

function navigateToProgress(targetProgress) {
    // Close About page if open
    if (aboutPageOpen) closeAboutPage();

    scrollProgress = targetProgress;
    gsap.to(tl, { 
        progress: targetProgress, 
        duration: 2.5, 
        ease: "power2.inOut",
        onUpdate: () => {
            document.querySelector('.progress-bar').style.setProperty('width', (tl.progress() * 100) + '%');
        }
    });
    
    // Update active nav
    updateMainNav(targetProgress > 0.2 ? 1 : 0);
}

const mobileNavItems = document.querySelectorAll('.mobile-bottom-nav .mb-nav-item');

function updateMainNav(activeIndex) {
    mainNavItems.forEach((item, idx) => {
        if (idx === activeIndex) item.classList.add('active');
        else item.classList.remove('active');
    });
    mobileNavItems.forEach((item, idx) => {
        if (idx === activeIndex) item.classList.add('active');
        else item.classList.remove('active');
    });
}

function openAboutPage() {
    aboutPage.classList.add('active');
    aboutPageOpen = true;
    updateMainNav(3); // Highlight About Us
}

function closeAboutPage() {
    aboutPage.classList.remove('active');
    aboutPageOpen = false;
}

// Wire up main nav clicks
mainNavItems.forEach((link, index) => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (index === 0) {
            // Home → zoom out to Earth
            navigateToProgress(0);
        } else if (index === 1) {
            // Explore → zoom in to show After 10th/12th cards
            navigateToProgress(1.0);
        } else if (index === 2) {
            // Resources → placeholder for now
            return;
        } else if (index === 3) {
            // About Us → open overlay
            if (aboutPageOpen) {
                closeAboutPage();
                updateMainNav(scrollProgress > 0.2 ? 1 : 0);
            } else {
                openAboutPage();
            }
        }
    });
});

// Wire up mobile nav clicks
mobileNavItems.forEach((link, index) => {
    // Only hijack the first two buttons if we are on the Home page (where GSAP tl exists)
    link.addEventListener('click', (e) => {
        // If we're on index.html or root, and we have the GSAP transition initialized
        const isHomePage = !window.location.pathname.includes('.html') || window.location.pathname.endsWith('index.html');
        
        if (isHomePage && typeof tl !== 'undefined') {
            if (index <= 1) {
                e.preventDefault();
                e.stopPropagation();
                if (index === 0) navigateToProgress(0);     // Home
                if (index === 1) navigateToProgress(1.0);   // Explore
            }
        }
    });
});

// Close About page when clicking outside content
aboutPage.addEventListener('click', (e) => {
    if (e.target === aboutPage) {
        closeAboutPage();
        updateMainNav(scrollProgress > 0.2 ? 1 : 0);
    }
});

const aboutBackBtn = document.getElementById('about-back-btn');
aboutBackBtn.addEventListener('click', () => {
    closeAboutPage();
    updateMainNav(scrollProgress > 0.2 ? 1 : 0);
});

// 8. Animation Loop
function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    
    // Safety Light follows camera to ensure Earth is ALWAYS visible
    cameraLight.position.copy(camera.position);
    
    // Constant Rotations
    cloudMesh.rotation.y += 0.0007;
    cloudMesh2.rotation.y += 0.0011;
    
    // Subtle "floating" pulse for clouds
    const cloudPulse = Math.sin(time * 0.5) * 0.01;
    cloudMesh.scale.set(1 + cloudPulse, 1 + cloudPulse, 1 + cloudPulse);
    cloudMesh2.scale.set(1 - cloudPulse, 1 - cloudPulse, 1 - cloudPulse);

    orbitText.rotation.y -= 0.002;
    moonMesh.rotation.y += 0.002;
    earthMesh.rotation.y += 0.0005; // Earth spins slowly
    
    // Moon — slow, realistic orbit around Earth
    // Speed 0.08 ≈ one full revolution every ~80 seconds (cinematic pacing)
    const moonOrbitSpeed = 0.08;
    const moonDist = 5.5;  // wider orbit for grandeur
    moonMesh.position.x = Math.sin(time * moonOrbitSpeed) * moonDist;
    moonMesh.position.z = Math.cos(time * moonOrbitSpeed) * moonDist;
    // Slight orbital inclination (5° tilt like real Moon)
    moonMesh.position.y = Math.sin(time * moonOrbitSpeed + Math.PI * 0.1) * 0.48;
    // Moon self-rotation (tidally locked — same face always toward Earth)
    moonMesh.rotation.y = -time * moonOrbitSpeed;
    
    spaceEnv.rotation.y = time * 0.003;
    
    // Mouse Pan (Only if not fully zoomed)
    const panFactor = 1 - scrollProgress;
    const targetRotY = mouseX * Math.PI * 0.3 * panFactor;
    const targetRotX = mouseY * Math.PI * 0.15 * panFactor;
    globeGroup.rotation.y += (targetRotY - globeGroup.rotation.y) * 0.05;
    globeGroup.rotation.x += (targetRotX - globeGroup.rotation.x) * 0.05;
    
    // ---- Blockchain Network Animation (Night Mode) ----
    if (blockchainNetwork) {
        const { packets, packetRoutes, nodeSprites } = blockchainNetwork;
        
        // Animate data packets travelling along routes
        const pPos = packets.geometry.attributes.position.array;
        packetRoutes.forEach((route, k) => {
            route.t += route.speed;
            if (route.t > 1) route.t -= 1;
            const pt = route.curve.getPoint(route.t);
            pPos[k * 3]     = pt.x;
            pPos[k * 3 + 1] = pt.y;
            pPos[k * 3 + 2] = pt.z;
        });
        packets.geometry.attributes.position.needsUpdate = true;
        
        // Pulse city node sprites
        nodeSprites.forEach((sprite) => {
            const pulse = 1 + 0.35 * Math.sin(time * 2.5 + sprite.userData.phase);
            const s = sprite.userData.baseScale * pulse;
            sprite.scale.set(s, s, s);
            sprite.material.opacity = 0.7 + 0.3 * Math.sin(time * 3 + sprite.userData.phase);
        });
    }

    // Fluid Interactive Stars Physics — LAYER 1 (white)
    cursorVector.x = mouseX;
    cursorVector.y = mouseY;
    raycaster.setFromCamera(cursorVector, camera);
    raycaster.ray.intersectPlane(targetPlane, intersectPoint);

    if (intersectPoint && interactableStars) {
        const localIntersect = intersectPoint.clone();
        interactableStars.worldToLocal(localIntersect);
        const positions = interactableStars.geometry.attributes.position.array;
        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const dx = positions[i3]   - localIntersect.x;
            const dy = positions[i3+1] - localIntersect.y;
            const distSq = dx * dx + dy * dy;
            // Larger repulsion radius (35 vs 25)
            if (distSq < 35.0) {
                const force = (35.0 - distSq) * 0.03;
                const mag = Math.sqrt(distSq) || 0.001;
                positions[i3]   += (dx / mag) * force;
                positions[i3+1] += (dy / mag) * force;
            }
            positions[i3]   += (baseStarPositions[i3]   - positions[i3])   * 0.05;
            positions[i3+1] += (baseStarPositions[i3+1] - positions[i3+1]) * 0.05;
        }
        interactableStars.geometry.attributes.position.needsUpdate = true;
    }

    // Fluid Interactive Stars Physics — LAYER 2 (purple/blue)
    if (intersectPoint && interactableStars2) {
        const localIntersect2 = intersectPoint.clone();
        interactableStars2.worldToLocal(localIntersect2);
        const pos2 = interactableStars2.geometry.attributes.position.array;
        for (let i = 0; i < starCount2; i++) {
            const i3 = i * 3;
            const dx = pos2[i3]   - localIntersect2.x;
            const dy = pos2[i3+1] - localIntersect2.y;
            const distSq = dx * dx + dy * dy;
            // Larger radius (45 vs 32)
            if (distSq < 45.0) {
                const force = (45.0 - distSq) * 0.025;
                const mag = Math.sqrt(distSq) || 0.001;
                pos2[i3]   += (dx / mag) * force;
                pos2[i3+1] += (dy / mag) * force;
            }
            pos2[i3]   += (baseStarPositions2[i3]   - pos2[i3])   * 0.04;
            pos2[i3+1] += (baseStarPositions2[i3+1] - pos2[i3+1]) * 0.04;
        }
        interactableStars2.geometry.attributes.position.needsUpdate = true;
    }

    // Falling Meteors Loop
    if (meteors) {
        const mPos = meteors.geometry.attributes.position.array;
        for (let i = 0; i < meteorCount; i++) {
            mPos[i*3] += meteorVel[i*3];
            mPos[i*3+1] += meteorVel[i*3+1];
            
            if (mPos[i*3+1] < -20) {
                mPos[i*3] = (Math.random() - 0.5) * 50; 
                mPos[i*3+1] = 10 + Math.random() * 20;  
            }
        }
        meteors.geometry.attributes.position.needsUpdate = true;
    }

    try {
        renderer.render(scene, camera);
    } catch (e) {
        console.error("3D Render Error caught:", e);
    }
}
animate();
// Initial force render to prevent blank screen
renderer.render(scene, camera);

// 9. Resize Handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Smooth responsive refresh for Globe size if user resizes back on Home
    if (scrollProgress < 0.1) {
        const mobile = window.innerWidth < 768;
        const base = mobile ? 0.9 : 2.1;
        gsap.to(globeGroup.scale, { x: base, y: base, z: base, duration: 0.5, overwrite: "auto" });
    }
});

// 10. Removed Sub-Page Transition Animations

