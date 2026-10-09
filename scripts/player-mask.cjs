const sharp = require('sharp');

// Match drawHead's 94x94 sprite, including its asymmetric anchor. Half-alpha
// rejects antialias haze; every solid pixel participates (hat, hair and ribbons).
module.exports = async function playerMask(source) {
  const size = 94;
  const { data } = await sharp(source).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const points = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (data[(y * size + x) * 4 + 3] >= 128) points.push([Math.round((x + .5 - size * .64)*100)/100, Math.round((y + .5 - size * .63)*100)/100]);
  }
  return { size, alphaThreshold: 128, radius: Math.SQRT1_2, points };
};
