/**
 * Layer 1(ish) — pure-ish browser utility, jsdom project (touches the
 * Canvas/Image APIs — browser APIs, not Firebase/React).
 *
 * jsdom implements the DOM API surface (Image, the canvas element,
 * URL.createObjectURL) but does not actually decode/rasterize image bytes
 * or implement canvas 2D rendering — CanvasRenderingContext2D.drawImage
 * and HTMLCanvasElement.toBlob are both stubbed as no-ops that never
 * fire, so these tests replace both with manual mocks that simulate real
 * width/height/onload timing, and spy on document.createElement to
 * inspect the actual canvas element's width/height after compressImage
 * resolves — a real, non-vacuous check of the scaling math, not just
 * "did toBlob get called."
 */
import { compressImage } from './compressImage';

describe('compressImage', () => {
    let createdCanvas;

    beforeEach(() => {
        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({ drawImage: jest.fn() }));
        HTMLCanvasElement.prototype.toBlob = jest.fn((callback) => {
            callback(new Blob(['fake'], { type: 'image/jpeg' }));
        });
        global.URL.createObjectURL = jest.fn(() => 'blob:fake-url');
        global.URL.revokeObjectURL = jest.fn();

        const realCreateElement = document.createElement.bind(document);
        jest.spyOn(document, 'createElement').mockImplementation((tag) => {
            const element = realCreateElement(tag);
            if (tag === 'canvas') createdCanvas = element;
            return element;
        });
    });

    afterEach(() => {
        document.createElement.mockRestore();
    });

    const mockImageWithDimensions = (width, height) => {
        const OriginalImage = global.Image;
        global.Image = class {
            set src(_value) {
                this.width = width;
                this.height = height;
                setTimeout(() => this.onload());
            }
        };
        return () => {
            global.Image = OriginalImage;
        };
    };

    it('scales a larger-than-max image down to the 1600px max dimension, preserving aspect ratio', async () => {
        const restore = mockImageWithDimensions(3200, 1600);
        const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

        const result = await compressImage(file);

        expect(createdCanvas.width).toBe(1600);
        expect(createdCanvas.height).toBe(800);
        expect(result).toBeInstanceOf(Blob);
        restore();
    });

    it('does not upscale an image already smaller than the max dimension', async () => {
        const restore = mockImageWithDimensions(400, 300);
        const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });

        const result = await compressImage(file);

        expect(createdCanvas.width).toBe(400);
        expect(createdCanvas.height).toBe(300);
        expect(result).toBeInstanceOf(Blob);
        restore();
    });
});
