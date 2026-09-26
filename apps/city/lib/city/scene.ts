/**
 * The Porchlight city: a procedural night-time city in three.js.
 *
 * Everything is generated from a seed, so the city looks the same on every screen:
 * a river along the north edge, a clock tower on the Hill, downtown towers, a mall, City Hall with its
 * radio mast (where uplinks land), and residential streets. The registry's households sit on a crescent;
 * three of them host Porchlight nodes, whose porch lights stay on when everything else goes dark.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

export type HouseholdStatus = "unknown" | "ok" | "help" | "acknowledged";
export type FocusTarget = "overview" | "hill" | "cityhall" | "crescent" | string;

export interface CityHousehold {
  id: string;
  label: string;
}

export interface CityOptions {
  /** "active" shows labels only for homes with news, node homes and the selected home. */
  labels?: boolean | "all" | "active";
  autoRotate?: boolean;
  interactive?: boolean;
  onSelect?: (householdId: string) => void;
}

const COLORS = {
  sky: new THREE.Color("#0c0f24"),
  ground: new THREE.Color("#141935"),
  road: new THREE.Color("#1c2246"),
  river: new THREE.Color("#10284a"),
  buildingA: new THREE.Color("#1e2446"),
  buildingB: new THREE.Color("#262d56"),
  roof: new THREE.Color("#2c3462"),
  porch: new THREE.Color("#f2b35e"),
  signal: new THREE.Color("#ff6a55"),
  moon: new THREE.Color("#9ec5ff"),
  unlit: new THREE.Color("#2b3159"),
  windowWarm: [new THREE.Color("#ffd89c"), new THREE.Color("#ffc879"), new THREE.Color("#ffe6bf")],
  windowCool: new THREE.Color("#cfe0ff"),
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WindowInfo {
  x: number;
  base: THREE.Color;
}

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y?: number;
  color?: THREE.Color;
  windows?: number;
}

interface HouseSlot {
  id: string;
  position: THREE.Vector3;
  door: THREE.Vector3;
  porch: THREE.Mesh;
  beam: THREE.Mesh;
  ring: THREE.Mesh;
  label?: CSS2DObject;
  status: HouseholdStatus;
  node: boolean;
}

interface Traveller {
  mesh: THREE.Mesh;
  trail: THREE.Mesh[];
  curve: THREE.QuadraticBezierCurve3;
  start: number;
  duration: number;
  onArrive?: () => void;
}

export class PorchlightCity {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly hemi: THREE.HemisphereLight;
  private readonly moonLight: THREE.DirectionalLight;
  private readonly windows: THREE.InstancedMesh;
  private readonly windowInfo: WindowInfo[] = [];
  private readonly streetLights: THREE.InstancedMesh;
  private readonly streetLightX: number[] = [];
  private readonly mastLight: THREE.Mesh;
  private readonly mastTop = new THREE.Vector3();
  private readonly houses = new Map<string, HouseSlot>();
  private readonly hitboxes: THREE.Mesh[] = [];
  private readonly travellers: Traveller[] = [];
  private rain?: THREE.LineSegments;
  /** Signs and clock faces that run on grid power and go dark with the storm. */
  private readonly gridLights: { mat: THREE.MeshBasicMaterial; base: THREE.Color; x: number }[] = [];
  private blackout = 0;
  private blackoutTarget = 0;
  private blackoutSpeed = 0.35;
  private storm = false;
  private cityLinkOnline = true;
  private raf = 0;
  private last = performance.now();
  private disposed = false;
  private readonly reducedMotion: boolean;
  private cameraTween?: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number; ms: number };
  private readonly resizeObserver: ResizeObserver;
  private selected?: string;

  constructor(
    private readonly container: HTMLElement,
    households: CityHousehold[],
    nodeHouseIds: string[],
    private readonly opts: CityOptions = {},
  ) {
    this.reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-label", "3D view of the city at night showing which households are safe or need help");
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    this.labelRenderer.domElement.className = "city-labels";
    container.appendChild(this.labelRenderer.domElement);

    this.scene.background = COLORS.sky;
    this.scene.fog = new THREE.FogExp2(COLORS.sky, 0.0022);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 1, 2000);
    this.camera.position.set(230, 170, 280);

    this.controls = new OrbitControls(this.camera, this.labelRenderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 520;
    this.controls.target.set(0, 0, 10);
    this.controls.autoRotate = Boolean(opts.autoRotate) && !this.reducedMotion;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.enabled = opts.interactive !== false;

    this.hemi = new THREE.HemisphereLight("#46508a", "#0a0c1c", 0.9);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight("#9fb4ff", 0.55);
    this.moonLight.position.set(-200, 300, -150);
    this.scene.add(this.moonLight);

    const rand = mulberry32(20260926);
    const boxes: Box[] = [];
    this.buildGround();
    this.buildHill(boxes);
    this.buildDowntown(boxes, rand);
    this.buildMall(boxes);
    this.buildCityHall(boxes);
    const houseLots = this.buildResidential(rand);
    this.buildBoxes(boxes);

    // Windows: one instanced mesh for the whole city, lit per instance.
    const windowPositions: { m: THREE.Matrix4; x: number }[] = [];
    for (const b of boxes) this.collectWindows(b, rand, windowPositions);
    for (const lot of houseLots) {
      for (const dx of [-1.4, 1.4]) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(lot.x + dx, 2.2, lot.z + lot.facing * 3.01),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lot.facing > 0 ? 0 : Math.PI),
          new THREE.Vector3(1.1, 1.2, 1),
        );
        windowPositions.push({ m, x: lot.x });
      }
    }
    this.windows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
      windowPositions.length,
    );
    windowPositions.forEach(({ m, x }, i) => {
      this.windows.setMatrixAt(i, m);
      const lit = rand() < 0.72;
      const base = lit ? (rand() < 0.12 ? COLORS.windowCool : COLORS.windowWarm[Math.floor(rand() * 3)]!).clone().multiplyScalar(0.9 + rand() * 0.6) : COLORS.unlit.clone().multiplyScalar(0.6);
      this.windowInfo.push({ x, base });
      this.windows.setColorAt(i, base);
    });
    this.scene.add(this.windows);

    // Street lights along the main avenues.
    const lampPositions: THREE.Vector3[] = [];
    for (let x = -190; x <= 190; x += 18) for (const z of [-8, 70]) lampPositions.push(new THREE.Vector3(x, 5, z));
    for (let z = -110; z <= 190; z += 18) for (const x of [-130, 60]) lampPositions.push(new THREE.Vector3(x, 5, z));
    this.streetLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), lampPositions.length);
    lampPositions.forEach((p, i) => {
      this.streetLights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      this.streetLights.setColorAt(i, new THREE.Color("#ffcf8f").multiplyScalar(1.4));
      this.streetLightX.push(p.x);
    });
    this.scene.add(this.streetLights);

    // City Hall mast light: the uplink target.
    this.mastLight = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), new THREE.MeshBasicMaterial({ color: COLORS.porch.clone().multiplyScalar(2), toneMapped: false }));
    this.mastLight.position.copy(this.mastTop);
    this.scene.add(this.mastLight);

    this.placeHouseholds(households, nodeHouseIds);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.95, 0.55, 0.18);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    if (opts.onSelect) {
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      this.labelRenderer.domElement.addEventListener("click", (e) => {
        const r = this.labelRenderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        const hit = ray.intersectObjects(this.hitboxes)[0];
        if (hit) opts.onSelect?.(hit.object.userData.householdId as string);
      });
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.loop();
  }

  // World building

  private buildGround(): void {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const river = new THREE.Mesh(new THREE.PlaneGeometry(700, 44), new THREE.MeshStandardMaterial({ color: COLORS.river, roughness: 0.15, metalness: 0.4 }));
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, 0.05, -200);
    this.scene.add(river);

    const roadMat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.9 });
    const road = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.06, z);
      this.scene.add(m);
    };
    road(0, -8, 420, 9);
    road(0, 70, 420, 9);
    road(-130, 40, 9, 330);
    road(60, 40, 9, 330);
    for (let x = -120; x <= 120; x += 32) road(x, -60, 6, 100);
    road(0, -112, 260, 7);
  }

  private buildHill(boxes: Box[]): void {
    const hill = new THREE.Mesh(new THREE.BoxGeometry(110, 5, 46), new THREE.MeshStandardMaterial({ color: "#1a2044", roughness: 1 }));
    hill.position.set(0, 2.5, -150);
    this.scene.add(hill);
    // Centre block and wings, stylised.
    boxes.push({ x: 0, z: -158, w: 70, d: 16, h: 14, y: 5, color: COLORS.buildingB, windows: 0.8 });
    boxes.push({ x: -42, z: -146, w: 14, d: 26, h: 12, y: 5, color: COLORS.buildingB, windows: 0.8 });
    boxes.push({ x: 42, z: -146, w: 14, d: 26, h: 12, y: 5, color: COLORS.buildingB, windows: 0.8 });
    // The clock tower.
    boxes.push({ x: 0, z: -140, w: 9, d: 9, h: 58, y: 5, color: COLORS.buildingB, windows: 0.5 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.2, 20, 4), new THREE.MeshStandardMaterial({ color: "#3b4a6a", roughness: 0.7 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 5 + 58 + 10, -140);
    this.scene.add(roof);
    const clockMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe3b0").multiplyScalar(1.3), toneMapped: false });
    this.gridLights.push({ mat: clockMat, base: clockMat.color.clone(), x: 0 });
    for (const [dx, dz, ry] of [[0, 4.6, 0], [0, -4.6, Math.PI], [4.6, 0, Math.PI / 2], [-4.6, 0, -Math.PI / 2]] as const) {
      const face = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), clockMat);
      face.position.set(dx, 5 + 50, -140 + dz);
      face.rotation.y = ry;
      this.scene.add(face);
    }
  }

  private buildDowntown(boxes: Box[], rand: () => number): void {
    for (let bx = -112; bx <= 112; bx += 32) {
      for (let bz = -98; bz <= -24; bz += 26) {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const w = 9 + rand() * 10;
          const d = 9 + rand() * 8;
          const central = 1 - Math.min(1, Math.hypot(bx, bz + 60) / 140);
          const h = 14 + rand() * 30 + central * 70 * rand();
          boxes.push({
            x: bx + (rand() - 0.5) * 14,
            z: bz + (rand() - 0.5) * 8,
            w,
            d,
            h,
            color: rand() < 0.5 ? COLORS.buildingA : COLORS.buildingB,
            windows: 1,
          });
        }
      }
    }
  }

  private buildMall(boxes: Box[]): void {
    boxes.push({ x: 128, z: 30, w: 70, d: 40, h: 11, color: COLORS.buildingB, windows: 0.35 });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(70, 26), new THREE.MeshStandardMaterial({ color: "#191f40", roughness: 1 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(128, 0.07, 58);
    this.scene.add(lot);
    const signMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#9ec5ff").multiplyScalar(1.4), toneMapped: false });
    this.gridLights.push({ mat: signMat, base: signMat.color.clone(), x: 128 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(30, 1.6, 0.4), signMat);
    sign.position.set(128, 9, 50.3);
    this.scene.add(sign);
  }

  private buildCityHall(boxes: Box[]): void {
    const cx = -88;
    const cz = 22;
    boxes.push({ x: cx, z: cz, w: 34, d: 20, h: 22, color: COLORS.buildingB, windows: 1 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 34, 8), new THREE.MeshStandardMaterial({ color: "#8390b8", roughness: 0.4, metalness: 0.6 }));
    mast.position.set(cx + 10, 22 + 17, cz);
    this.scene.add(mast);
    this.mastTop.set(cx + 10, 22 + 35, cz);
  }

  private buildResidential(rand: () => number): { x: number; z: number; facing: number }[] {
    const lots: { x: number; z: number; facing: number }[] = [];
    const avoid = (x: number, z: number) => Math.hypot(x + 40, z - 132) < 60 || (x > 90 && z < 80) || (x < -60 && z < 45 && x > -115);
    for (let z = 88; z <= 190; z += 22) {
      for (let x = -190; x <= 190; x += 13) {
        if (avoid(x, z) || rand() < 0.12) continue;
        lots.push({ x: x + (rand() - 0.5) * 2, z: z + (rand() - 0.5) * 1.5, facing: (z / 22) % 2 === 0 ? 1 : -1 });
      }
    }
    for (let z = 20; z <= 60; z += 20) {
      for (let x = -40; x <= 40; x += 13) {
        if (rand() < 0.2) continue;
        lots.push({ x, z, facing: 1 });
      }
    }
    this.instanceHouses(lots, rand);
    return lots;
  }

  private instanceHouses(lots: { x: number; z: number; facing: number }[], rand: () => number): void {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 5, 6), new THREE.MeshStandardMaterial({ color: COLORS.buildingB, roughness: 0.9 }), lots.length);
    const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(5.4, 3.4, 4), new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.9 }), lots.length);
    lots.forEach((l, i) => {
      body.setMatrixAt(i, new THREE.Matrix4().makeTranslation(l.x, 2.5, l.z));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
      roof.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(l.x, 5 + 1.7, l.z), q, new THREE.Vector3(1, 1, 0.85)));
      body.setColorAt(i, (rand() < 0.5 ? COLORS.buildingA : COLORS.buildingB).clone());
    });
    this.scene.add(body, roof);
  }

  private buildBoxes(boxes: Box[]): void {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 }), boxes.length);
    boxes.forEach((b, i) => {
      const y = (b.y ?? 0) + b.h / 2;
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(b.x, y, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d)));
      mesh.setColorAt(i, (b.color ?? COLORS.buildingA).clone());
    });
    this.scene.add(mesh);
  }

  private collectWindows(b: Box, rand: () => number, out: { m: THREE.Matrix4; x: number }[]): void {
    if (!b.windows) return;
    const baseY = b.y ?? 0;
    const floors = Math.min(28, Math.floor((b.h - 3) / 3.3));
    const faces: { axis: "x" | "z"; sign: number; width: number }[] = [
      { axis: "z", sign: 1, width: b.w },
      { axis: "z", sign: -1, width: b.w },
      { axis: "x", sign: 1, width: b.d },
      { axis: "x", sign: -1, width: b.d },
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor((f.width - 2) / 2.8));
      for (let fl = 0; fl < floors; fl++) {
        for (let c = 0; c < cols; c++) {
          if (rand() > b.windows) continue;
          const along = -f.width / 2 + 1.6 + c * ((f.width - 3.2) / Math.max(1, cols - 1 || 1));
          const y = baseY + 3 + fl * 3.3;
          const pos =
            f.axis === "z"
              ? new THREE.Vector3(b.x + along, y, b.z + f.sign * (b.d / 2 + 0.05))
              : new THREE.Vector3(b.x + f.sign * (b.w / 2 + 0.05), y, b.z + along);
          const rot = f.axis === "z" ? (f.sign > 0 ? 0 : Math.PI) : f.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
          const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1.3, 1.7, 1));
          out.push({ m, x: pos.x });
        }
      }
    }
  }

  private placeHouseholds(households: CityHousehold[], nodeHouseIds: string[]): void {
    const cx = -40;
    const cz = 132;
    const radius = 42;
    const n = households.length;
    const bodyMat = new THREE.MeshStandardMaterial({ color: "#2e3668", roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: "#3a4378", roughness: 0.8 });
    const crescent = new THREE.Mesh(new THREE.RingGeometry(radius - 5, radius + 5, 64, 1, Math.PI * 0.1, Math.PI * 0.8), new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.9 }));
    crescent.rotation.x = -Math.PI / 2;
    crescent.position.set(cx, 0.08, cz);
    this.scene.add(crescent);

    households.forEach((h, i) => {
      const a = Math.PI * 0.12 + (Math.PI * 0.76 * i) / Math.max(1, n - 1);
      const x = cx + Math.cos(a) * (radius + 11);
      const z = cz - Math.sin(a) * (radius + 11);
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.lookAt(cx, 0, cz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(8, 5.5, 7), bodyMat);
      body.position.y = 2.75;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.1, 3.8, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 5.5 + 1.9;
      roof.scale.set(1, 1, 0.9);
      group.add(body, roof);
      this.scene.add(group);

      group.updateMatrixWorld(true);
      const door = new THREE.Vector3(0, 3.2, 3.8).applyMatrix4(group.matrixWorld);
      const porch = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshBasicMaterial({ color: COLORS.unlit.clone(), toneMapped: false }));
      porch.position.copy(door);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 90, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      beam.position.set(x, 45, z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(6, 7.2, 48),
        new THREE.MeshBasicMaterial({ color: COLORS.porch, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.12, z);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x, 6, z);
      hit.userData.householdId = h.id;
      this.hitboxes.push(hit);
      this.scene.add(porch, beam, ring, hit);

      const slot: HouseSlot = { id: h.id, position: new THREE.Vector3(x, 6, z), door, porch, beam, ring, status: "unknown", node: nodeHouseIds.includes(h.id) };
      if (this.opts.labels) {
        const el = document.createElement("div");
        el.className = "city-label";
        el.dataset.status = "unknown";
        const name = document.createElement("span");
        name.className = "city-label-name";
        name.textContent = h.label;
        const st = document.createElement("span");
        st.className = "city-label-status";
        st.textContent = "Not heard from";
        el.append(name, st);
        const label = new CSS2DObject(el);
        label.position.set(x, 13, z);
        this.scene.add(label);
        slot.label = label;
      }
      if (slot.node) {
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.55;
      }
      this.houses.set(h.id, slot);
      this.applyStatus(slot);
    });
  }

  // Public API

  setHouseholdStatus(id: string, status: HouseholdStatus): void {
    const slot = this.houses.get(id);
    if (!slot || slot.status === status) return;
    slot.status = status;
    this.applyStatus(slot);
  }

  private applyStatus(slot: HouseSlot): void {
    const porchMat = slot.porch.material as THREE.MeshBasicMaterial;
    const beamMat = slot.beam.material as THREE.MeshBasicMaterial;
    const text: Record<HouseholdStatus, string> = { unknown: slot.node ? "Porchlight node" : "Not heard from", ok: "Safe", help: "Needs help", acknowledged: "Help on the way" };
    switch (slot.status) {
      case "ok":
        porchMat.color.copy(COLORS.porch).multiplyScalar(2.2);
        beamMat.opacity = 0;
        break;
      case "help":
        porchMat.color.copy(COLORS.signal).multiplyScalar(2.4);
        beamMat.color.copy(COLORS.signal);
        beamMat.opacity = 0.32;
        break;
      case "acknowledged":
        porchMat.color.copy(COLORS.moon).multiplyScalar(2.2);
        beamMat.color.copy(COLORS.moon);
        beamMat.opacity = 0.22;
        break;
      default:
        porchMat.color.copy(slot.node ? COLORS.porch.clone().multiplyScalar(1.6) : COLORS.unlit);
        beamMat.opacity = 0;
    }
    if (slot.label) {
      const el = slot.label.element;
      el.dataset.status = slot.status;
      el.dataset.selected = String(this.selected === slot.id);
      const st = el.querySelector(".city-label-status");
      if (st) st.textContent = text[slot.status];
      const show = this.opts.labels === "all" || slot.status !== "unknown" || slot.node || this.selected === slot.id;
      slot.label.visible = show;
    }
  }

  /** Highlights one home and makes sure its label is visible. */
  select(id: string | null): void {
    this.selected = id ?? undefined;
    for (const slot of this.houses.values()) this.applyStatus(slot);
  }

  /** 0 = every light on, 1 = the storm has crossed the whole city. Animated toward the target. */
  setBlackout(target: number, speed = 0.35): void {
    this.blackoutTarget = Math.min(1, Math.max(0, target));
    this.blackoutSpeed = speed;
    if (this.reducedMotion) this.blackout = this.blackoutTarget;
  }

  setStorm(on: boolean): void {
    this.storm = on && !this.reducedMotion;
    if (this.storm && !this.rain) this.makeRain();
    if (this.rain) this.rain.visible = this.storm;
  }

  setCityLink(online: boolean): void {
    this.cityLinkOnline = online;
  }

  /** A message hopping between two households' nodes. */
  pulse(fromId: string, toId: string, color: THREE.ColorRepresentation = COLORS.porch, onArrive?: () => void): void {
    const a = this.houses.get(fromId);
    const b = this.houses.get(toId);
    if (!a || !b) return;
    const mid = a.position.clone().lerp(b.position, 0.5).add(new THREE.Vector3(0, 18 + a.position.distanceTo(b.position) * 0.25, 0));
    this.launch(new THREE.QuadraticBezierCurve3(a.position.clone(), mid, b.position.clone()), color, 1100, onArrive);
  }

  /** A delivery from a household's node up to City Hall's mast. */
  uplink(fromId: string, color: THREE.ColorRepresentation = COLORS.porch, onArrive?: () => void): void {
    const a = this.houses.get(fromId);
    if (!a) return;
    const mid = a.position.clone().lerp(this.mastTop, 0.5).add(new THREE.Vector3(0, 70, 0));
    this.launch(new THREE.QuadraticBezierCurve3(a.position.clone(), mid, this.mastTop.clone()), color, 1600, () => {
      this.flashMast();
      onArrive?.();
    });
  }

  private launch(curve: THREE.QuadraticBezierCurve3, color: THREE.ColorRepresentation, duration: number, onArrive?: () => void): void {
    const c = new THREE.Color(color).multiplyScalar(2.6);
    const make = (r: number, o: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, toneMapped: false }));
      this.scene.add(m);
      return m;
    };
    const mesh = make(1.5, 1);
    const trail = [make(1.1, 0.55), make(0.8, 0.3), make(0.5, 0.15)];
    this.travellers.push({ mesh, trail, curve, start: performance.now(), duration: this.reducedMotion ? 1 : duration, onArrive });
  }

  private mastFlashUntil = 0;
  private flashMast(): void {
    this.mastFlashUntil = performance.now() + 450;
  }

  focus(target: FocusTarget, ms = 1600): void {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (target === "overview") {
      pos = new THREE.Vector3(230, 170, 280);
      look = new THREE.Vector3(0, 0, 10);
    } else if (target === "hill") {
      pos = new THREE.Vector3(70, 60, -60);
      look = new THREE.Vector3(0, 30, -145);
    } else if (target === "cityhall") {
      pos = new THREE.Vector3(-20, 70, 100);
      look = new THREE.Vector3(-88, 25, 22);
    } else if (target === "crescent") {
      pos = new THREE.Vector3(40, 90, 230);
      look = new THREE.Vector3(-40, 0, 120);
    } else {
      const slot = this.houses.get(target);
      if (!slot) return;
      look = slot.position.clone();
      pos = slot.position.clone().add(new THREE.Vector3(38, 34, 52));
    }
    if (this.reducedMotion || ms <= 0) {
      this.camera.position.copy(pos);
      this.controls.target.copy(look);
      return;
    }
    this.cameraTween = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: look, start: performance.now(), ms };
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on && !this.reducedMotion;
  }

  // Frame loop

  private makeRain(): void {
    const n = 1800;
    const pos = new Float32Array(n * 6);
    const rand = mulberry32(7);
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * 520;
      const y = rand() * 220;
      const z = (rand() - 0.5) * 520;
      pos.set([x, y, z, x - 1.2, y - 5, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#7f93c9", transparent: true, opacity: 0.35 }));
    this.scene.add(this.rain);
  }

  private updateLights(): void {
    const front = -240 + this.blackout * 480;
    const dark = new THREE.Color();
    const c = new THREE.Color();
    for (let i = 0; i < this.windowInfo.length; i++) {
      const w = this.windowInfo[i]!;
      const t = Math.min(1, Math.max(0, (front - w.x) / 24));
      c.copy(w.base).lerp(dark.copy(COLORS.unlit).multiplyScalar(0.25), t);
      this.windows.setColorAt(i, c);
    }
    this.windows.instanceColor!.needsUpdate = true;
    for (let i = 0; i < this.streetLightX.length; i++) {
      const t = Math.min(1, Math.max(0, (front - this.streetLightX[i]!) / 24));
      c.set("#ffcf8f").multiplyScalar(1.4 * (1 - t) + 0.05 * t);
      this.streetLights.setColorAt(i, c);
    }
    this.streetLights.instanceColor!.needsUpdate = true;
    for (const g of this.gridLights) {
      const t = Math.min(1, Math.max(0, (front - g.x) / 24));
      g.mat.color.copy(g.base).multiplyScalar(1 - t * 0.97);
    }
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const realDt = Math.min(1, (now - this.last) / 1000);
    const dt = Math.min(0.1, realDt);
    this.last = now;

    if (this.blackout !== this.blackoutTarget) {
      const step = this.blackoutSpeed * realDt; // wall-clock based, so slow machines see the same storm

      this.blackout = this.blackout < this.blackoutTarget ? Math.min(this.blackoutTarget, this.blackout + step) : Math.max(this.blackoutTarget, this.blackout - step);
      this.updateLights();
    }

    if (this.storm) {
      this.hemi.intensity = Math.random() < 0.012 ? 3.2 : THREE.MathUtils.lerp(this.hemi.intensity, 0.9, 0.2);
      if (this.rain) {
        const p = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
        const a = p.array as Float32Array;
        for (let i = 0; i < a.length; i += 6) {
          let dy = -160 * dt;
          let dx = 40 * dt;
          if (a[i + 1]! + dy < 0) dy += 220;
          if (a[i]! + dx > 260) dx -= 520;
          a[i] = a[i]! + dx;
          a[i + 3] = a[i + 3]! + dx;
          a[i + 1] = a[i + 1]! + dy;
          a[i + 4] = a[i + 4]! + dy;
        }
        p.needsUpdate = true;
      }
    } else {
      this.hemi.intensity = THREE.MathUtils.lerp(this.hemi.intensity, 0.9, 0.1);
    }

    // Mast: steady when the city link is up, slow red blink when down, bright flash on delivery.
    const mastMat = this.mastLight.material as THREE.MeshBasicMaterial;
    if (now < this.mastFlashUntil) mastMat.color.set("#ffffff").multiplyScalar(3);
    else if (this.cityLinkOnline) mastMat.color.copy(COLORS.porch).multiplyScalar(2);
    else mastMat.color.copy(COLORS.signal).multiplyScalar(Math.floor(now / 700) % 2 ? 2 : 0.2);

    // Help beams breathe; rings pulse.
    for (const slot of this.houses.values()) {
      if (slot.status === "help") {
        const k = this.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin(now / 260);
        (slot.porch.material as THREE.MeshBasicMaterial).color.copy(COLORS.signal).multiplyScalar(0.8 + 1.8 * k);
        const ringMat = slot.ring.material as THREE.MeshBasicMaterial;
        ringMat.color.copy(COLORS.signal);
        const s = 1 + ((now / 1400) % 1) * 1.6;
        slot.ring.scale.set(s, s, s);
        ringMat.opacity = 0.7 * (1 - ((now / 1400) % 1));
      } else {
        slot.ring.scale.set(1, 1, 1);
        const ringMat = slot.ring.material as THREE.MeshBasicMaterial;
        ringMat.color.copy(COLORS.porch);
        ringMat.opacity = slot.node ? 0.55 : 0;
      }
    }

    for (let i = this.travellers.length - 1; i >= 0; i -= 1) {
      const t = this.travellers[i]!;
      const k = Math.min(1, (now - t.start) / t.duration);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      t.mesh.position.copy(t.curve.getPoint(e));
      t.trail.forEach((m, j) => m.position.copy(t.curve.getPoint(Math.max(0, e - 0.04 * (j + 1)))));
      if (k >= 1) {
        for (const m of [t.mesh, ...t.trail]) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        this.travellers.splice(i, 1);
        t.onArrive?.();
      }
    }

    if (this.cameraTween) {
      const tw = this.cameraTween;
      const k = Math.min(1, (now - tw.start) / tw.ms);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(tw.from, tw.to, e);
      this.controls.target.lerpVectors(tw.tFrom, tw.tTo, e);
      if (k >= 1) this.cameraTween = undefined;
    }

    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  private onVisibility = (): void => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else {
      this.last = performance.now();
      this.loop();
    }
  };

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
