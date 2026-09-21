export function resizeInNotebook(width: number, height: number, dx: number, dy: number, angle: number, locked: boolean) {
  const radians = angle * Math.PI / 180;
  const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
  const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
  const scale = Math.max(10 / Math.min(width, height), Math.min(400 / Math.max(width, height), 1 + (localX * width + localY * height) / (width * width + height * height)));
  return {
    width: Math.round((locked ? width * scale : Math.max(10, Math.min(400, width + localX))) * 10) / 10,
    height: Math.round((locked ? height * scale : Math.max(10, Math.min(400, height + localY))) * 10) / 10,
  };
}

export function outsideNotebook(x: number, y: number, width: number, height: number, angle: number, pageWidth: number, pageHeight: number) {
  const radians = angle * Math.PI / 180;
  const halfWidth = (Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))) / 2;
  const halfHeight = (Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))) / 2;
  return x - halfWidth < -0.01 || y - halfHeight < -0.01 || x + halfWidth > pageWidth + 0.01 || y + halfHeight > pageHeight + 0.01;
}
