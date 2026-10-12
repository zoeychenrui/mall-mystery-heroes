// Resizes and re-compresses an image File before upload — mobile camera
// photos can be several MB, and this keeps uploads fast on weak venue
// connections and keeps Storage costs down
// (docs/superpowers/specs/2026-08-13-kill-photo-submission-design.md).
// Touches the Canvas API (a browser API, not Firebase/React), same
// category as MessageFeed.js's DOM scroll handling.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export const compressImage = (file) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = image.width * scale;
            canvas.height = image.height * scale;
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY);
            URL.revokeObjectURL(image.src);
        };
        image.onerror = reject;
        image.src = URL.createObjectURL(file);
    });
