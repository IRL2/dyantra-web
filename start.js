"use strict";

import * as THREE from "three";
import Stats from "stats";
import { VRButton } from './VRButton.js';
import { pickFiles, textFromFile } from "./utility.js";

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

export default async function start() {
    const params = new URLSearchParams(document.location.search);
    const showAttractors = params.has("attractors");
    const velocityColored = params.get("velocity") != "false";
    const pointCount = parseFloat(params.get("count") ?? "0") || Math.pow(2, 13);
    const svgurl = params.get("svg");
    const zoom = parseFloat(params.get("zoom") ?? "1");

    const attractors = params.getAll("attractor").map((data) => {
        const [x, y, z, radius, amplitude] = data.split(",").map((param) => parseFloat(param));
        return make_attractor(new THREE.Vector3(x, y, z), radius, amplitude);
    });

    if (attractors.length == 0) {
        attractors.push(make_attractor(new THREE.Vector3( 0,  0, 0).multiplyScalar(1),  1,  .05))
        attractors.push(make_attractor(new THREE.Vector3( 0,  0, 0).multiplyScalar(1), .25, -.05))
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
        const totalLength = Array.from(geometries).map((geometry) => geometry.getTotalLength()).reduce((a, b) => a + b);
        let i = 0;

        const position = new THREE.Vector3();

        for (const geometry of geometries) {
            const share = geometry.getTotalLength() / totalLength;
            const count = Math.floor(state.count * share);
            const delta = geometry.getTotalLength() / count;

            const matrix = geometry.transform.baseVal.consolidate()?.matrix;
            
            for (let j = 0; j < count; ++j) {
                let point = geometry.getPointAtLength(j * delta);
                if (matrix) {
                    point = point.matrixTransform(matrix);
                }

                position.set(point.x, point.y, 0);
                position.toArray(state.p, i * 3);
                i += 1;
            }
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

    document.addEventListener("keydown", async (event) => {
        if (event.key == "s") {
            const svg = await pickSVG();

            prev = make_particle_state(pointCount);
            next = make_particle_state(pointCount);
            generate_points_svg(svg, next);
            center_points(next);
        }
    });

    let prev = make_particle_state(pointCount);
    let next = make_particle_state(pointCount);

    if (svgurl) {
        const svg = await loadSVG(svgurl);
        generate_points_svg(svg, next);
        center_points(next);
    } else {
        generate_points(next);
    }

    prev.c.set(next.c);

    // threejs + xr setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.autoClear = false;
    document.querySelector("body").appendChild(renderer.domElement);

    document.body.appendChild(VRButton.createButton(renderer));
    renderer.xr.enabled = true;

    renderer.xr.addEventListener("sessionstart", () => {
        pointsMat.size = .01;
        pointsObject.position.set(0, 1, -1);
    });

    const clock = new THREE.Clock();

    const stats = Stats();
    document.body.appendChild(stats.dom);

    const scene = new THREE.Scene();
    
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
    camera.position.set(0, 0, 1);
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    // particle geometry
    const pointsMat = new THREE.PointsMaterial({
        size: 4, 
        map: new THREE.TextureLoader().load("particle.webp"), 
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const pointsGeometry = make_particle_geometry(pointCount);
    const pointsObject = new THREE.Points(pointsGeometry, pointsMat);

    scene.add(pointsObject);

    // physics
    const temp = new THREE.Vector3();
    const temp_p = new THREE.Vector3();
    const temp_f = new THREE.Vector3();
    const temp_v = new THREE.Vector3();
    const temp_c = new THREE.Color();

    // render attractors
    if (showAttractors) {
        const attractorMat = new THREE.MeshBasicMaterial( { color: 0xffff00, transparent: true, opacity: .1, depthWrite: false } ); 
        for (const attractor of attractors) {
            const geo = new THREE.SphereGeometry(attractor.radius);
            const sphere = new THREE.Mesh(geo, attractorMat);
            sphere.position.copy(attractor.position);
            scene.add(sphere);
        }
    }

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
        for (let i = 0; i < pointCount; ++i) {
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
        for (let i = 0; i < pointCount; ++i) {
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

        // next.v = prev.v + (prev.f + next.f) * s;
        for (let i = 0; i < pointCount; ++i) {
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

    // fit browser window
    function resize() {
        if (renderer.xr.isPresenting)
            return;

        const parent = renderer.domElement.parentElement;
        const { width, height } = parent.getBoundingClientRect();

        const size = 1 / zoom;
        const aspect = width / height;

        renderer.setSize(width, height, true);
        renderer.setPixelRatio(window.devicePixelRatio);

        camera.left   = size * aspect / -2;
        camera.right  = size * aspect /  2;
        camera.top    = size / -2;
        camera.bottom = size /  2;
        camera.updateProjectionMatrix();
    }

    window.addEventListener("resize", resize);
    renderer.xr.addEventListener("sessionend", resize);
    resize();

    // control loop
    function animate() {
        const dt = Math.min(1/15, clock.getDelta());

        update(dt);
        render();

        stats.update();
    }
    renderer.setAnimationLoop(animate);

    function update(dt) {
        updateParticles(dt);
    }

    function render() {
        renderer.render(scene, camera);
    }
}
