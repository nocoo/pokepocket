/** Enlarge exported frames without blurring pixels or changing stored save previews. */
export async function upscaleScreenshot(source: string): Promise<Blob> {
  const image = new Image();
  image.src = source;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.height = 1080;
  canvas.width = Math.round((image.naturalWidth / image.naturalHeight) * canvas.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成截图，请稍后重试。');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('截图导出失败，请稍后重试。'));
    }, 'image/png');
  });
}
