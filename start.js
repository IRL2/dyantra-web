"use strict";

import * as THREE from "three";
import Stats from "stats";
import { VRButton } from './VRButton.js';
import { pickFiles, textFromFile, html } from "./utility.js";

function make_particle_state(count) {
    return {
        count,
        p: new Float32Array(3 * count),
        f: new Float32Array(3 * count),
        v: new Float32Array(3 * count),
        c: new Float32Array(3 * count),
    };
}

function make_attractor(position, radius, amplitude) {
    return {
        position,
        radius,
        amplitude,
        coefficient: amplitude / (radius * radius),
        inv_exp_denominator: 1 / (-2 * radius * radius),
    }
}

function generate_points(state) {
    const count = state.count;
    const count1 = (state.count / 2) | 0;
    const count2 = count - count1;

    const counts = [count1, count2];
    let offset = 0;
    
    const temp_p = new THREE.Vector3();
    const temp_c = new THREE.Color().setHSL(.45, .75, .5);

    for (let c = 0; c < counts.length; ++c) {
        const count = counts[c];

        for (let i = 0; i < count; ++i) {
            const angle = Math.PI * 2 * i / count;
            const off = Math.sin(angle * 8 + c*Math.PI) * .05 - c * .1;
            const mag = 1 + off * 2;
            temp_p.set(
                Math.cos(angle)*mag, 
                Math.sin(angle)*mag, 
                0,
            );

            temp_c.setHSL(angle % 1, .75, .5);

            temp_p.toArray(state.p, (i + offset) * 3);
            temp_c.toArray(state.c, (i + offset) * 3);
        }

        offset += count;
    }
}

function make_particle_geometry(count) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    return geometry;
}

const PARAM_DEFS = new Map();
const PARAM_VALS = new Map();

function DEF_PARAM(id, deserializer, serializer, ...fallbacks) {
    PARAM_DEFS.set(id, { id, deserializer, serializer, fallbacks });
}

const parseBool = (text) => text == "true";
const parseString = (text) => text;
const toString = (value) => value?.toString();

function parseAttractor(text) {
    const [x, y, z, radius, amplitude] = text.split(",").map((param) => parseFloat(param));
    return make_attractor(new THREE.Vector3(x, y, z), radius, amplitude);
}

/**
 * @param {ReturnType<typeof make_attractor>} attractor
 */
function serializeAttractor(attractor) {
    const { position, radius, amplitude } = attractor;
    const { x, y, z } = position;
    return [x, y, z, radius, amplitude].join(",");
}

DEF_PARAM("count", parseFloat, toString, Math.pow(2, 13));
DEF_PARAM("attractors", parseBool, toString, false);
DEF_PARAM("velocity", parseBool, toString, true);
DEF_PARAM("zoom", parseFloat, toString, 1);
DEF_PARAM("svg", parseString, toString, undefined);
DEF_PARAM("attractor", parseAttractor, serializeAttractor,
    make_attractor(new THREE.Vector3(0, 0, 0).multiplyScalar(1),  1,  .05),
    make_attractor(new THREE.Vector3(0, 0, 0).multiplyScalar(1), .25, -.05),
);
DEF_PARAM("depth", parseFloat, toString, 2);
DEF_PARAM("loop", parseFloat, toString, Infinity);

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

function GET_PARAM(id) {
    return PARAM_VALS.get(id)[0];
}

function SET_PARAM(id, value) {
    PARAM_VALS.set(id, [value]);
    WRITE_PARAMS();
}

function GET_PARAM_ALL(id) {
    return PARAM_VALS.get(id);
}

function SET_PARAM_ALL(id, ...values) {
    PARAM_VALS.set(values);
    WRITE_PARAMS();
}

export default async function start() {
    READ_PARAMS();
    
    for (const [id, values] of PARAM_VALS) {
        console.log(id, values);
    }

    const pointsMaterial = new THREE.PointsMaterial({
        size: 4, 
        map: new THREE.TextureLoader().load("particle.webp"), 
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    let pointsGeometry;
    let pointsObject = new THREE.Points(make_particle_geometry(1), pointsMaterial);

    /** @type {ReturnType<typeof make_particle_state>} */
    let prev, next;

    function RESIZE_PARTICLE_COUNT(count) {
        pointsGeometry?.dispose();
        pointsGeometry = make_particle_geometry(count);
        pointsObject.geometry = pointsGeometry;

        prev = make_particle_state(count);
        next = make_particle_state(count);
    }

    async function RELOAD() {
        RESIZE_PARTICLE_COUNT(GET_PARAM("count"));

        const svgurl = GET_PARAM("svg");

        if (svgurl) {
            const svg = await loadSVG(svgurl);
            generate_points_svg(svg, next);
        } else {
            generate_points(next);
        }

        center_points(next);
        prev.c.set(next.c);
    }

    function setupUI() {
        const uiToggle = document.getElementById('ui-toggle');
        const uiPanel = document.getElementById('ui-panel');
        const particleCountInput = document.getElementById('particle-count');
        const zoomLevelInput = document.getElementById('zoom-level');
        const zoomValueDisplay = document.getElementById('zoom-value');
        const depthInput = document.getElementById('depth');
        const depthValueDisplay = document.getElementById('depth-value');
        const svgUrlInput = document.getElementById('svg-url');
        const loadSvgButton = document.getElementById('load-svg-file');
        const attractorsContainer = document.getElementById('attractors-container');
        const addAttractorButton = document.getElementById('add-attractor');

        const particleCountContainer = document.querySelector("#particle-count-container");

        function refreshParticleCountUI() {
            const count = document.querySelector(`input[name="particle-count"]`)?.value ?? prev.count;
            SET_PARAM("count", count);

            // If point count changed, recreate particle system
            if (count !== prev.count) {
                RESIZE_PARTICLE_COUNT(GET_PARAM("count"));
                scene.add(pointsObject);
                
                // Generate new points
                if (GET_PARAM("svg")) {
                    loadSVG(GET_PARAM("svg")).then(svg => {
                        generate_points_svg(svg, next);
                        center_points(next);
                    });
                } else {
                    generate_points(next);
                }
            } 

            particleCountContainer.querySelector("span").innerText = ` (${count})`;
        }

        particleCountInput.value = GET_PARAM("count");
        particleCountContainer.querySelector("span").innerText = ` (${GET_PARAM("count")})`;
        particleCountInput.addEventListener("input", () => refreshParticleCountUI());

        // Initialize UI values from URL params
        particleCountInput.value = GET_PARAM("count");
        zoomLevelInput.value = GET_PARAM("zoom");
        zoomValueDisplay.textContent = GET_PARAM("zoom").toFixed(2);
        svgUrlInput.value = GET_PARAM("svg") ?? "";

        depthInput.value = GET_PARAM("depth");
        depthValueDisplay.textContent = GET_PARAM("depth").toFixed(2);

        // Populate attractors
        attractors.forEach((attractor, index) => {
            addAttractorToUI(attractor, index);
        });

        // Toggle UI visibility
        uiToggle.addEventListener('click', () => {
            uiPanel.classList.toggle('visible');
            if (uiPanel.classList.contains('visible')) {
                uiToggle.textContent = '✕ Close';
            } else {
                uiToggle.textContent = '⚙️ Settings';
            }
        });

        svgUrlInput.addEventListener("change", () => {
            SET_PARAM("svg", svgUrlInput.value);
            RESIZE_PARTICLE_COUNT(GET_PARAM("count"));
            loadSVG(svgUrlInput.value).then(svg => {
                generate_points_svg(svg, next);
                center_points(next);
            });
        });

        // Update zoom value display
        zoomLevelInput.addEventListener('input', () => {
            zoomValueDisplay.textContent = parseFloat(zoomLevelInput.value).toFixed(2);
        });

        // Update depth display
        depthInput.addEventListener('input', () => {
            depthValueDisplay.textContent = parseFloat(depthInput.value).toFixed(2);
            SET_PARAM("depth", parseFloat(depthInput.value));
        });

        // Load local SVG file
        loadSvgButton.addEventListener('click', async () => {
            try {
                const svg = await pickSVG();
                svgUrlInput.value = ''; // Clear URL when loading local file
                
                // Reset simulation with new SVG
                RESIZE_PARTICLE_COUNT(GET_PARAM("count"));
                generate_points_svg(svg, next);
                center_points(next);
                
                // Update graphics
                const positions = pointsGeometry.getAttribute("position");
                const colors = pointsGeometry.getAttribute("color");
                positions.array = next.p;
                positions.needsUpdate = true;
                colors.array = next.c;
                colors.needsUpdate = true;
            } catch (error) {
                console.error("Error loading SVG:", error);
            }
        });

        // Add new attractor
        addAttractorButton.addEventListener('click', () => {
            const newAttractor = make_attractor(new THREE.Vector3(0, 0, 0), 1, 0.05);
            attractors.push(newAttractor);
            addAttractorToUI(newAttractor, attractors.length - 1);

            updateAttractorsFromUI();
            SET_PARAM_ALL("attractor", ...attractors);
            refreshAttractorObjects();
        });

        function renderNumberUI(name, label, value, step, min=-1, max=1) {
            const display = html("span", {}, ` (${value})`);

            const input = html("input", { type: "range", name, step, value, min, max });
            input.addEventListener("input", () => {
                display.textContent = ` (${input.value})`;
                updateAttractorsFromUI();
                SET_PARAM_ALL("attractor", ...attractors);
                refreshAttractorObjects();
            });

            return html("div", {},
                html("label", {}, `${label}:`, display, input),
            );
        }

        function addAttractorToUI(attractor, index) {
            const attractorItem = document.createElement('div');
            attractorItem.className = 'attractor-item';
            attractorItem.dataset.index = index;
            attractorItem.append(
                html("div", { class: "attractor-controls" },
                    renderNumberUI("x", "X", attractor.position.x, 0.1),
                    renderNumberUI("y", "Y", attractor.position.y, 0.1),
                    renderNumberUI("z", "Z", attractor.position.z, 0.1),
                    renderNumberUI("radius", `Radius`, attractor.radius, 0.1),
                    renderNumberUI("amplitude", `Amplitude`, attractor.amplitude, 0.01),
                )
            );
            attractorItem.append(html("button", { class: "remove-attractor" }, "Remove"));

            attractorsContainer.appendChild(attractorItem);

            // Add event listener for the remove button
            attractorItem.querySelector('.remove-attractor').addEventListener('click', () => {
                attractors.splice(index, 1);
                attractorItem.remove();
                // Update indices for remaining attractors
                updateAttractorIndices();
                refreshAttractorObjects();
                SET_PARAM_ALL("attractor", ...attractors);
            });
        }

        function updateAttractorIndices() {
            const attractorItems = attractorsContainer.querySelectorAll('.attractor-item');
            attractorItems.forEach((item, index) => {
                item.dataset.index = index;
            });
        }

        document.querySelector("input#zoom-level").addEventListener("input", () => {
            const newZoom = parseFloat(zoomLevelInput.value);
            SET_PARAM("zoom", newZoom);
            UPDATE_VIEWPORT();
        });

        function updateAttractorsFromUI() {
            // Update attractors
            const attractorItems = attractorsContainer.querySelectorAll('.attractor-item');
            attractors.length = 0; // Clear existing attractors
            
            attractorItems.forEach((item) => {
                const x = parseFloat(item.querySelector(`input[name="x"]`).value);
                const y = parseFloat(item.querySelector(`input[name="y"]`).value);
                const z = parseFloat(item.querySelector(`input[name="z"]`).value);
                const radius = parseFloat(item.querySelector(`input[name="radius"]`).value);
                const amplitude = parseFloat(item.querySelector(`input[name="amplitude"]`).value);
                
                attractors.push(make_attractor(new THREE.Vector3(x, y, z), radius, amplitude));
            });
        }
    }

    async function pickSVG() {
        const [file] = await pickFiles("*.svg");
        const text = await textFromFile(file);
        const parser = new DOMParser();
        const svg = parser.parseFromString(text, "image/svg+xml");
        return svg;
    }

    async function loadSVG(url) {
        const text = await fetch(url).then((r) => r.text());
        const parser = new DOMParser();
        const svg = parser.parseFromString(text, "image/svg+xml");
        return svg;
    }

    function generate_points_svg(svg, state) {
        /** @type {SVGGeometryElement[]} */
        const geometries = svg.querySelectorAll("path");
        let offset = 0;
        let error = 0;

        const lengths = Array.from(geometries).map((geometry) => geometry.getTotalLength());
        const lengthsTotal = lengths.reduce((a, b) => a + b);

        const position = new THREE.Vector3();

        for (let i = 0; i < geometries.length; ++i) {
            const geometry = geometries[i];

            const share = lengths[i] / lengthsTotal;
            let count = Math.floor(state.count * share);
            const delta = lengths[i] / count;

            error += state.count * share - count;

            if (error > 0) {
                count += Math.ceil(error);
                error -= Math.ceil(error);
            }

            const matrix = geometry.transform.baseVal.consolidate()?.matrix;
            
            for (let j = 0; j < count && j < state.count; ++j) {
                let point = geometry.getPointAtLength(j * delta);
                if (matrix) {
                    point = point.matrixTransform(matrix);
                }

                position.set(point.x, point.y, 0);
                position.toArray(state.p, offset + j * 3);
            }

            offset += count * 3;
        }
    }

    function center_points(state) {
        const center = new THREE.Vector3();
        const bounds = new THREE.Box3();
        const position = new THREE.Vector3();

        for (let i = 0; i < state.count; ++i) {
            position.fromArray(state.p, i * 3);
            center.add(position);
            bounds.expandByPoint(position);
        }

        center.multiplyScalar(1 / state.count);
        const size = bounds.getSize(new THREE.Vector3());
        const axis = Math.max(size.x, size.y);
        const scale = new THREE.Vector3(1 / axis, 1 / axis, 1);

        for (let i = 0; i < state.count; ++i) {
            position.fromArray(state.p, i * 3);
            position.sub(center);
            position.multiply(scale);
            position.toArray(state.p, i * 3);
        }
    }

    // threejs + xr setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.autoClear = false;
    document.querySelector("body").appendChild(renderer.domElement);

    document.body.appendChild(VRButton.createButton(renderer));
    renderer.xr.enabled = true;

    const clock = new THREE.Clock();

    const stats = Stats();

    const scene = new THREE.Scene();
    
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
    camera.position.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    const objects = new THREE.Object3D();
    objects.add(pointsObject);

    scene.add(objects);

    // physics
    const temp = new THREE.Vector3();
    const temp_p = new THREE.Vector3();
    const temp_f = new THREE.Vector3();
    const temp_v = new THREE.Vector3();
    const temp_c = new THREE.Color();

    const attractors = GET_PARAM_ALL("attractor");

    // render attractors
    const attractorGroup = new THREE.Object3D();
    const attractorMat = new THREE.MeshBasicMaterial( { color: 0xffff00, transparent: true, opacity: .1, depthWrite: false } ); 
    function refreshAttractorObjects() {
        attractorGroup.clear();
        for (const attractor of attractors) {
            const geo = new THREE.SphereGeometry(attractor.radius);
            const sphere = new THREE.Mesh(geo, attractorMat);
            sphere.position.copy(attractor.position);
            attractorGroup.add(sphere);
        }
    }
    refreshAttractorObjects();
    objects.add(attractorGroup);

    function updateParticles(dt) {
        // flip prev/next buffers
        [prev, next] = [next, prev];

        // update graphics buffers
        const positions = pointsGeometry.getAttribute("position");
        const colors = pointsGeometry.getAttribute("color");
        positions.array = next.p;
        positions.needsUpdate = true;
        colors.array = next.c;
        colors.needsUpdate = true;

        // factors
        const m = 1;
        const s1 = 0.5 * dt      / m;
        const s2 = 0.5 * dt * dt / m;

        // next.p = prev.p + prev.v * dt + prev.f * s;
        for (let i = 0; i < prev.count; ++i) {
            temp_p.fromArray(prev.p, i*3);
            temp_v.fromArray(prev.v, i*3);
            temp_f.fromArray(prev.f, i*3);

            temp_p.addScaledVector(temp_v, dt);
            temp_p.addScaledVector(temp_f, s2);

            temp_p.toArray(next.p, i * 3);
        }

        // dp = prev.p - attractor.p
        // exponent = (dp . dp) * attractor.inv_exp_denominator
        // next.f = sum(dp * -attractor.coefficient * exp(exponent))
        for (let i = 0; i < prev.count; ++i) {
            temp_p.fromArray(prev.p, i*3);
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

            temp_f.toArray(next.f, i*3);
        }

        const velocityColored = GET_PARAM("velocity");

        // next.v = prev.v + (prev.f + next.f) * s;
        for (let i = 0; i < prev.count; ++i) {
            temp_f.fromArray(prev.f, i*3);
            temp.fromArray(next.f, i*3);
            temp_f.add(temp)

            temp_v.fromArray(prev.v, i*3);
            temp_v.addScaledVector(temp_f, s1);

            temp_v.toArray(next.v, i*3);

            // color by velocity
            if (velocityColored) {
                const v = temp_v.lengthSq();
                temp_c.setHSL(v, .75, .5);
                temp_c.toArray(next.c, i*3);
            }
        }
    }

    const menu = document.getElementById('ui-panel');
    function IS_MENU_OPEN() {
        return menu.classList.contains("visible");
    }

    // fit browser window
    function UPDATE_VIEWPORT() {
        if (renderer.xr.isPresenting)
            return;

        const parent = renderer.domElement.parentElement;
        const { width, height } = parent.getBoundingClientRect();

        const size = 1 / GET_PARAM("zoom");
        const aspect = width / height;

        pointsMaterial.size = 4 * GET_PARAM("zoom");

        renderer.setSize(width, height, true);
        renderer.setPixelRatio(window.devicePixelRatio);

        if (width > height) {
            camera.left   = size * aspect / -2;
            camera.right  = size * aspect /  2;
            camera.top    = size / -2;
            camera.bottom = size /  2;
        } else {
            camera.left   = size / -2;
            camera.right  = size /  2;
            camera.top    = size / aspect / -2;
            camera.bottom = size / aspect /  2;
        }

        camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", UPDATE_VIEWPORT);
    UPDATE_VIEWPORT();

    // xr mode
    const target = new THREE.Vector3();
    const rotation = new THREE.Matrix4();
    const ray = new THREE.Ray();

    renderer.xr.addEventListener("sessionstart", enter_xr);
    renderer.xr.addEventListener("sessionend", exit_xr);

    function enter_xr() {
        pointsMaterial.size = .01 * 1.2;
        objects.position.set(0, 1, -1);
    }

    function exit_xr() {
        UPDATE_VIEWPORT();

        pointsMaterial.size = 4;
        objects.position.set(0, 0, 0);
        objects.rotation.set(0, 0, 0);

        camera.position.set(0, 0, 1);
        camera.lookAt(new THREE.Vector3(0, 0, 0));
    }

    function update_xr(dt) {
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

        const dt = 0.01 * step_sign; //Math.min(1/15, clock.getDelta());
        // const dt = 0;

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

        updateParticles(dt);
        renderer.render(scene, camera);

        attractorGroup.visible = IS_MENU_OPEN();
        if (IS_MENU_OPEN()) document.body.append(stats.dom);
        else stats.dom.remove();
        stats.update();
    }
    renderer.setAnimationLoop(animate);

    // Setup UI controls
    setupUI();

    RELOAD();
}

