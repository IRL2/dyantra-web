import GUI from 'lil-gui'
import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  BufferGeometry,
  BufferGeometryEventMap,
  Clock,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBufferAttributes,
  Object3D,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Ray,
  Scene,
  Sphere,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three'
import Stats from 'stats.js'
import { toggleFullScreen } from './helpers/fullscreen'
import './style.css'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'

type State = ReturnType<typeof make_particle_state>;
type Attractor = ReturnType<typeof make_attractor>;

const CANVAS_ID = 'scene'

let canvas: HTMLElement
let renderer: WebGLRenderer
let audio = document.createElement("audio");
let scene: Scene
let camera: OrthographicCamera
let stats: Stats
let gui: GUI
let objects: Object3D

async function init() {
  READ_PARAMS();

  for (const [id, values] of PARAM_VALS) {
    console.log(id, values);
  }

  canvas = document.querySelector(`canvas#${CANVAS_ID}`)!
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  scene = new Scene()

  renderer.setAnimationLoop(animate);

  renderer.xr.enabled = true;
  renderer.xr.addEventListener("sessionstart", enter_xr);
  renderer.xr.addEventListener("sessionend", exit_xr);

  objects = new Object3D();
  scene.add(objects);

  camera = new OrthographicCamera(-1, 1, 1, -1, -500, 500);
  camera.position.set(0, 0, 1);
  camera.lookAt(new Vector3(0, 0, 0));

  // Full screen
  window.addEventListener('dblclick', (event) => {
    if (event.target === canvas) {
      toggleFullScreen(canvas)
    }
  });

  stats = new Stats()
  document.body.appendChild(stats.dom)
  document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ["hand-tracking"] }));

  function RESET() {
    const path = GET_PARAM("svg") ?? shapePaths[0].path;

    RESIZE_PARTICLE_COUNT(GET_PARAM("count"));
    loadShape(path);
  }

  gui = new GUI({ title: 'Configuration', width: 300 })
  gui.close();

  const settings = {
    count: GET_PARAM("count"),
    zoom: GET_PARAM("zoom"),
    depth: GET_PARAM("depth"),
    velocity: GET_PARAM("velocity"),
    music: GET_PARAM("music"),
  }

  const generalFolder = gui.addFolder("General");
  const countSlider = generalFolder.add(settings, "count", 5000, 250000, 5000).name("Particle Count");
  const zoomSlider = generalFolder.add(settings, "zoom", .1, 2, .05).name("Zoom");
  const depthSlider = generalFolder.add(settings, "depth", 0, 10, .05).name("VR Distance");
  const velocityToggle = generalFolder.add(settings, "velocity").name("Color by Velocity");
  const musicToggle = generalFolder.add(settings, "music").name("Play Music");

  countSlider.onFinishChange((count: number) => {
    SET_PARAM("count", count);
    RESET();
  });

  zoomSlider.onChange((zoom: number) => {
    SET_PARAM("zoom", zoom);
    UPDATE_VIEWPORT();
  });

  depthSlider.onChange((depth: number) => SET_PARAM("depth", depth));
  velocityToggle.onChange((velocity: boolean) => SET_PARAM("velocity", velocity));

  musicToggle.onChange((music: boolean) => {
    SET_PARAM("music", music);

    if (!music) {
      audio.pause();
    } else {
      audio.currentTime = 0;
      audio.play();
    }
  });

  const shapePaths = [
    { name: "Tara Crown", path: "tara-crown-perfect.svg" },
    { name: "Tara Heart Lotus", path: "tara-crown-heart-lotus.svg" },
    { name: "Tara Face", path: "tara-face.svg" },
    { name: "Tara Yantra", path: "tara-yantra.svg" },
    // { name: "Seasonal Circle", path: "cir-seasonal-us.svg" },
  ];

  for (const shape of shapePaths)
  {
    shape.path = new URL("./svgs/" + shape.path, window.location.href).toString();
  }

  async function loadShape(path: string) {
    RESIZE_PARTICLE_COUNT(next.count);
    const response = await fetch(path);
    const text = await response.text();
    const svg = new DOMParser().parseFromString(text, "image/svg+xml");
    const points = generate_points_svg(svg, next);

    next.p = points;
    center_points(next);
    prev.p.set(next.p);
    prev.c.set(next.c);
  }

  const svgsFolder = gui.addFolder("Shapes");
  for (const { name, path } of shapePaths) {
    svgsFolder.add({ load: () => loadShape(path) }, "load").name(name);
  }

  async function pickAndLoadSVG()
  {
    const [file] = await pickFiles(".svg");
    const text = await textFromFile(file);
    const parser = new DOMParser();
    const svg = parser.parseFromString(text, "image/svg+xml");
    const points = generate_points_svg(svg, next);

    RESIZE_PARTICLE_COUNT(GET_PARAM("count"));
    next.p = points;
    center_points(next);
    prev.p.set(next.p);
    prev.c.set(next.c);
  } 

  svgsFolder.add({ load: () => pickAndLoadSVG() }, "load").name("Use SVG File");

  let attractorsFolder = gui.addFolder("Attractors");

  function refreshAttractorsUI() {
    attractorsFolder.destroy();
    attractorsFolder = gui.addFolder("Attractors");

    const attractors = GET_PARAM_ALL("attractor") as Attractor[];

    function refresh() {
      SET_PARAM_ALL("attractor", ...attractors);
      refreshAttractors();
    }

    for (const attractor of attractors) {
      function remove() {
        attractors.splice(attractors.findIndex((v) => v == attractor), 1);
        SET_PARAM_ALL("attractor", ...attractors);
      refreshAttractors();
        refreshAttractorsUI();
      }

      const folder = attractorsFolder.addFolder("Attractor");
      folder.add(attractor.position, "x", -1, 1, .1).onChange(refresh);
      folder.add(attractor.position, "y", -1, 1, .1).onChange(refresh);
      folder.add(attractor.position, "z", -1, 1, .1).onChange(refresh);
      folder.add(attractor, "radius", 0, 1, .05).onChange(refresh);
      folder.add(attractor, "amplitude", -1, 1, .1).onChange(refresh);
      folder.add({ remove }, "remove").name("Remove");
    }

    function add() {
      attractors.push(make_attractor(new Vector3(0, 0, 0), 1, .05));
      SET_PARAM_ALL("attractor", ...attractors);
      refreshAttractors();
      refreshAttractorsUI();
    }

    attractorsFolder.add({ add }, "add").name("Add");
  }
  refreshAttractorsUI();

  let prev: State, next: State;

  function RESIZE_PARTICLE_COUNT(count: number) {
    pointsGeometry?.dispose();
    pointsGeometry = make_particle_geometry(count);
    pointsGeometry.boundingSphere = new Sphere(undefined, Infinity);
    pointsObject.geometry = pointsGeometry;

    prev = make_particle_state(count);
    next = make_particle_state(count);
  }

  const pointsMaterial = new PointsMaterial({
    size: 4,
    map: new TextureLoader().load("particle.webp"),
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  let pointsGeometry: BufferGeometry<NormalBufferAttributes, BufferGeometryEventMap>;
  let pointsObject = new Points(make_particle_geometry(1), pointsMaterial);
  RESIZE_PARTICLE_COUNT(GET_PARAM("count"));

  function center_points(state: State) {
    const center = new Vector3();
    const bounds = new Box3();
    const position = new Vector3();

    for (let i = 0; i < state.count; ++i) {
      position.fromArray(state.p, i * 3);
      center.add(position);
      bounds.expandByPoint(position);
    }

    center.multiplyScalar(1 / state.count);
    const size = bounds.getSize(new Vector3());
    const axis = Math.max(size.x, size.y);
    const scale = new Vector3(1 / axis, 1 / axis, 1);

    for (let i = 0; i < state.count; ++i) {
      position.fromArray(state.p, i * 3);
      position.sub(center);
      position.multiply(scale);
      position.toArray(state.p, i * 3);
    }
  }

  const clock = new Clock();

  objects.add(pointsObject);

  // physics
  const temp = new Vector3();
  const temp_p = new Vector3();
  const temp_f = new Vector3();
  const temp_v = new Vector3();
  const temp_c = new Color();

  let attractors = GET_PARAM_ALL("attractor");
  function refreshAttractors() {
    READ_PARAMS();
    attractors = GET_PARAM_ALL("attractor");
    refreshAttractorObjects();
  }

  // render attractors
  const attractorGroup = new Object3D();
  const attractorMat = new MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: .1, depthWrite: false });
  function refreshAttractorObjects() {
    attractorGroup.clear();
    for (const attractor of attractors) {
      const geo = new SphereGeometry(attractor.radius);
      const sphere = new Mesh(geo, attractorMat);
      sphere.position.copy(attractor.position);
      attractorGroup.add(sphere);
    }
  }
  refreshAttractorObjects();
  objects.add(attractorGroup);

  function updateParticles(dt: number) {
    // flip prev/next buffers
    [prev, next] = [next, prev];

    // update graphics buffers
    const positions = pointsGeometry.getAttribute("position");
    const colors = pointsGeometry.getAttribute("color");
    // @ts-ignore
    positions.array = next.p;
    positions.needsUpdate = true;
    // @ts-ignore
    colors.array = next.c;
    colors.needsUpdate = true;

    // factors
    const m = 1;
    const s1 = 0.5 * dt / m;
    const s2 = 0.5 * dt * dt / m;

    // next.p = prev.p + prev.v * dt + prev.f * s;
    for (let i = 0; i < prev.count; ++i) {
      temp_p.fromArray(prev.p, i * 3);
      temp_v.fromArray(prev.v, i * 3);
      temp_f.fromArray(prev.f, i * 3);

      temp_p.addScaledVector(temp_v, dt);
      temp_p.addScaledVector(temp_f, s2);

      temp_p.toArray(next.p, i * 3);
    }

    // dp = prev.p - attractor.p
    // exponent = (dp . dp) * attractor.inv_exp_denominator
    // next.f = sum(dp * -attractor.coefficient * exp(exponent))
    for (let i = 0; i < prev.count; ++i) {
      temp_p.fromArray(prev.p, i * 3);
      temp_f.set(0, 0, 0);

      for (const attractor of attractors) {
        temp.subVectors(temp_p, attractor.position);

        const exp_numerator = temp.lengthSq();
        const prefactor =
          - attractor.coefficient
          * Math.exp(exp_numerator * attractor.inv_exp_denominator);

        temp.multiplyScalar(prefactor);

        temp_f.add(temp);
      }

      temp_f.toArray(next.f, i * 3);
    }

    const velocityColored = GET_PARAM("velocity");
    const color = GET_PARAM("color");

    // next.v = prev.v + (prev.f + next.f) * s;
    for (let i = 0; i < prev.count; ++i) {
      temp_f.fromArray(prev.f, i * 3);
      temp.fromArray(next.f, i * 3);
      temp_f.add(temp)

      temp_v.fromArray(prev.v, i * 3);
      temp_v.addScaledVector(temp_f, s1);

      temp_v.toArray(next.v, i * 3);

      // color by velocity
      if (color) {
        temp_c.set(color);
        temp_c.toArray(next.c, i * 3);
      } else if (velocityColored) {
        const v = temp_v.lengthSq();
        temp_c.setHSL(v, .75, .5);
        temp_c.toArray(next.c, i * 3);
      }
    }
  }

  function IS_MENU_OPEN() {
    return !gui._closed;
  }

  // fit browser window
  function UPDATE_VIEWPORT() {
    if (renderer.xr.isPresenting)
      return;

    const parent = renderer.domElement.parentElement!;
    const { width, height } = parent.getBoundingClientRect();

    const size = 1 / GET_PARAM("zoom");
    const aspect = width / height;

    pointsMaterial.size = 4 * GET_PARAM("zoom");

    renderer.setSize(width, height, true);
    renderer.setPixelRatio(window.devicePixelRatio);

    camera.left = size * aspect / -2;
    camera.right = size * aspect / 2;
    camera.top = size / -2;
    camera.bottom = size / 2;

    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", UPDATE_VIEWPORT);
  UPDATE_VIEWPORT();

  // xr mode
  const target = new Vector3();
  const rotation = new Matrix4();
  const ray = new Ray();

  renderer.xr.addEventListener("sessionstart", enter_xr);
  renderer.xr.addEventListener("sessionend", exit_xr);

  function enter_xr() {
    pointsMaterial.size = .01 * 1.2;
    objects.position.set(0, 1, -1);

    audio.play();
    step_sign = step_sign == 0 ? 1 : step_sign;
  }

  function exit_xr() {
    UPDATE_VIEWPORT();

    pointsMaterial.size = 4;
    objects.position.set(0, 0, 0);
    objects.rotation.set(0, 0, 0);

    camera.position.set(0, 0, 1);
    camera.lookAt(new Vector3(0, 0, 0));
  }

  function update_xr(dt: number) {
    const camera = renderer.xr.getCamera();

    rotation.identity().extractRotation(camera.matrixWorld);
    ray.direction.set(0, 0, -1).applyMatrix4(rotation);
    ray.origin.setFromMatrixPosition(camera.matrixWorld);

    const depth = GET_PARAM("depth");
    const scale = GET_PARAM("zoom"); // + Math.max(depth - 2, 0) * .5;

    ray.at(depth, target);
    objects.scale.set(scale, scale, scale);

    target.sub(objects.position);
    target.multiplyScalar(dt);
    objects.position.add(target);

    objects.lookAt(ray.origin);
  }

  const step_limit = GET_PARAM("loop");
  let steps = 0;
  let step_sign = 1;

  // control loop
  function animate() {
    const dt = Math.min(1 / 15, clock.getDelta());

    steps += step_sign;
    if (steps > step_limit) {
      step_sign *= -1;
    }

    if (steps <= 0) {
      step_sign = 0;
    }

    if (renderer.xr.isPresenting) {
      update_xr(dt);
    }

    updateParticles(0.01 * step_sign);
    renderer.render(scene, camera);

    attractorGroup.visible = !attractorsFolder._closed && !gui._closed;
    if (IS_MENU_OPEN()) document.body.append(stats.dom);
    else stats.dom.remove();
    stats.update();
  }

  if (GET_PARAM("music")) {
    audio.src = "./chenresi-dewa.mp3"
    await fetch(audio.src);

    try {
      await audio.play();
    } catch (e) {
      step_sign = 0;
      document.addEventListener("click", () => {
        audio.play();
        step_sign = 1;
      }, { once: true });
    }
  }

  RESET();
}

// import { pickFiles, textFromFile } from "./utility.js";

function make_particle_state(count: number) {
  return {
    count,
    p: new Float32Array(3 * count),
    f: new Float32Array(3 * count),
    v: new Float32Array(3 * count),
    c: new Float32Array(3 * count),
  };
}

function make_attractor(position: Vector3, radius: number, amplitude: number) {
  return {
    position,
    radius,
    amplitude,
    coefficient: amplitude / (radius * radius),
    inv_exp_denominator: 1 / (-2 * radius * radius),
  }
}

function make_particle_geometry(count: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
  return geometry;
}

const PARAM_DEFS = new Map<string, any>();
const PARAM_VALS = new Map<string, any>();

function DEF_PARAM<T>(id: string, deserializer: any, serializer: any, ...fallbacks: T[]) {
  PARAM_DEFS.set(id, { id, deserializer, serializer, fallbacks });
}

const parseBool = (text: string) => text == "true";
const parseString = (text: string) => text;
const toString = (value: string) => value?.toString();

function parseAttractor(text: string) {
  const [x, y, z, radius, amplitude] = text.split(",").map((param) => parseFloat(param));
  return make_attractor(new Vector3(x, y, z), radius, amplitude);
}

function serializeAttractor(attractor: Attractor) {
  const { position, radius, amplitude } = attractor;
  const { x, y, z } = position;
  return [x, y, z, radius, amplitude].join(",");
}

function parseColor(text: string) {
  return new Color("#" + text);
}

DEF_PARAM("count", parseFloat, toString, Math.pow(2, 13));
DEF_PARAM("attractors", parseBool, toString, false);
DEF_PARAM("velocity", parseBool, toString, true);
DEF_PARAM("zoom", parseFloat, toString, 1);
DEF_PARAM("svg", parseString, toString, undefined);
DEF_PARAM("attractor", parseAttractor, serializeAttractor,
  make_attractor(new Vector3(0, 0, 0).multiplyScalar(1), 1, .05),
  make_attractor(new Vector3(0, 0, 0).multiplyScalar(1), .25, -.05),
);
DEF_PARAM("depth", parseFloat, toString, 2);
DEF_PARAM("loop", parseFloat, toString, Infinity);
DEF_PARAM("music", parseBool, toString, true);
DEF_PARAM("color", parseColor, (color: Color) => color?.getHexString(), undefined);

function READ_PARAMS() {
  const params = new URLSearchParams(document.location.search);

  for (const def of PARAM_DEFS.values()) {
    const vals = params.getAll(def.id).map((text) => def.deserializer(text));
    PARAM_VALS.set(def.id, vals.length > 0 ? vals : def.fallbacks);
  }
}

function WRITE_PARAMS() {
  const url = new URL(location.href.replace(location.search, ""));

  for (const def of PARAM_DEFS.values()) {
    for (const value of PARAM_VALS.get(def.id)) {
      const text = def.serializer(value);
      if (text) url.searchParams.append(def.id, text);
    }
  }

  window.history.replaceState({}, "", url.toString());
}

export function GET_PARAM(id: string) {
  return PARAM_VALS.get(id)[0];
}

export function SET_PARAM(id: string, value: any) {
  PARAM_VALS.set(id, [value]);
  WRITE_PARAMS();
}

export function GET_PARAM_ALL(id: string) {
  return PARAM_VALS.get(id);
}

export function SET_PARAM_ALL(id: string, ...values: any[]) {
  PARAM_VALS.set(id, values);
  WRITE_PARAMS();
}

function generate_points_svg(svg: Document, state: State) {
  const geometries = svg.querySelectorAll("path");
  let offset = 0;
  let error = 0;

  const lengths = Array.from(geometries).map((geometry) => geometry.getTotalLength());
  const lengthsTotal = lengths.reduce((a, b) => a + b);

  const total = state.count;
  const position = new Vector3();
  const points = new Float32Array(total * 3);

  for (let i = 0; i < geometries.length; ++i) {
    const geometry = geometries[i];

    const share = lengths[i] / lengthsTotal;
    let count = Math.floor(total * share);
    const delta = lengths[i] / count;

    error += count * share - count;

    if (error > 0) {
      count += Math.ceil(error);
      error -= Math.ceil(error);
    }

    const matrix = geometry.transform.baseVal.consolidate()?.matrix;

    for (let j = 0; j < count && j < count; ++j) {
      let point = geometry.getPointAtLength(j * delta);
      if (matrix) {
        point = point.matrixTransform(matrix);
      }

      position.set(point.x, point.y, 0);
      position.toArray(points, offset + j * 3);
    }

    offset += count * 3;
  }

  return points;
}

export async function pickFiles(accept = "*", multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = accept;
    fileInput.multiple = multiple;
    fileInput.style = "visibility: collapse";

    console.log(fileInput)

    document.body.append(fileInput);
    function done(files: File[]) {
      fileInput.remove();
      resolve(files);
    }

    fileInput.addEventListener("change", () => done(Array.from(fileInput.files!)));
    fileInput.addEventListener("cancel", () => done([]));
    fileInput.click();
  });
}

export async function textFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(file);
  });
}

init()
