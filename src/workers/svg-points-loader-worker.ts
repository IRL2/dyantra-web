import { Vector3 } from "three";

export type SetupMessageData = {
  port: MessagePort;
}

export type RecvMessageData = {
  svg: Document;
  count: number;
}

export type SendMessageData = {
  points: Float32Array;
}

onmessage = (event) => {
  const { port } = event.data as SetupMessageData;
  port.addEventListener("message", async (event) => {
    const { svg, count } = event.data as RecvMessageData;
    const points = generate_points_svg(svg, count);

    port.postMessage({ points } as SendMessageData, {transfer: [points]});
  });
  port.start();
};

function generate_points_svg(svg: Document, total: number): Float32Array {
  const geometries = svg.querySelectorAll("path");
  let offset = 0;
  let error = 0;

  const lengths = Array.from(geometries).map((geometry) => geometry.getTotalLength());
  const lengthsTotal = lengths.reduce((a, b) => a + b);

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
