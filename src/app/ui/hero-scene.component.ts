import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input } from '@angular/core';
import type * as THREE from 'three';

/**
 * three.js scene for the start screen: contract pages floating in space, a
 * signature drawing itself in light across them, and particles in the theme's
 * two colours. Follows the pointer; colours follow theme changes.
 */
@Component({
  selector: 'cs-hero-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  templateUrl: './hero-scene.component.html',
  styleUrl: './hero-scene.component.scss',
})
export class HeroScene {
  /** Celebration mode: pages spin and particles burst outward. */
  readonly celebrate = input(false);

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  #cleanup: (() => void) | null = null;

  constructor() {
    afterNextRender(() => void this.#start());
    inject(DestroyRef).onDestroy(() => this.#cleanup?.());
  }

  async #start(): Promise<void> {
    const T = await import('three');
    const canvas = this.#host.querySelector('canvas')!;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset['motion'] === 'reduce';
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.2, 9);

    const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#4f46e5';
    const accent = new T.Color(css('--accent'));
    const accent2 = new T.Color(css('--accent-2'));
    const dark = () => document.documentElement.dataset['theme'] === 'dark';

    scene.add(new T.AmbientLight(0xffffff, 1.4));
    const key = new T.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 4, 6);
    scene.add(key);
    const rim = new T.PointLight(accent2, 18, 20);
    rim.position.set(-4, -2, 3);
    scene.add(rim);

    // Pages: a canvas texture with headings, text lines and a stamp.
    const pageTexture = (seed: number) => {
      const c = document.createElement('canvas');
      c.width = 420;
      c.height = 594;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#1f2937';
      g.fillRect(40, 50, 220, 18);
      g.fillStyle = '#cbd5e1';
      for (let i = 0; i < 16; i++) {
        g.fillRect(40, 100 + i * 24, 300 - ((i * 37 + seed * 53) % 120), 8);
      }
      g.strokeStyle = `#${accent.getHexString()}`;
      g.lineWidth = 3;
      g.globalAlpha = 0.55;
      g.beginPath();
      g.arc(320, 500, 44, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = 4;
      return tex;
    };
    const pages: THREE.Mesh[] = [];
    const pageGeo = new T.BoxGeometry(2.1, 2.97, 0.02);
    const placements = [
      [-2.6, 0.5, -1.2, 0.35, -0.25], [0, 0, 0, 0.1, 0.05], [2.7, -0.4, -0.8, -0.3, 0.2], [-1.3, -1.6, -2.4, 0.2, 0.4], [1.6, 1.7, -2.8, -0.25, -0.3],
    ];
    placements.forEach(([x, y, z, ry, rz], i) => {
      const face = new T.MeshStandardMaterial({ map: pageTexture(i), roughness: 0.7, metalness: 0 });
      const edge = new T.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.8 });
      const mesh = new T.Mesh(pageGeo, [edge, edge, edge, edge, face, edge]);
      mesh.position.set(x, y, z);
      mesh.rotation.set(-0.1, ry, rz);
      mesh.userData = { base: mesh.position.clone(), phase: i * 1.3, spin: rz };
      scene.add(mesh);
      pages.push(mesh);
    });

    // The signature: a glowing tube that draws itself across the front page.
    const sigPoints = [
      [-0.9, -0.85], [-0.6, -0.55], [-0.45, -0.95], [-0.2, -0.5], [-0.05, -0.9], [0.2, -0.65], [0.38, -0.8], [0.62, -0.62], [0.9, -0.72],
    ].map(([x, y]) => new T.Vector3(x, y, 0.06));
    const curve = new T.CatmullRomCurve3(sigPoints, false, 'catmullrom', 0.5);
    const tubeGeo = new T.TubeGeometry(curve, 240, 0.022, 10, false);
    const tubeMat = new T.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.1, roughness: 0.3 });
    const signature = new T.Mesh(tubeGeo, tubeMat);
    pages[1].add(signature);
    const totalIndices = tubeGeo.index!.count;
    const pen = new T.Mesh(new T.SphereGeometry(0.05, 16, 16), new T.MeshBasicMaterial({ color: accent2 }));
    pages[1].add(pen);

    // Particles in the two theme colours.
    const count = 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions.set([(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8 - 2], i * 3);
      const c = Math.random() > 0.5 ? accent : accent2;
      colors.set([c.r, c.g, c.b], i * 3);
      speeds[i] = 0.2 + Math.random() * 0.6;
    }
    const pGeo = new T.BufferGeometry();
    pGeo.setAttribute('position', new T.BufferAttribute(positions, 3));
    pGeo.setAttribute('color', new T.BufferAttribute(colors, 3));
    const pMat = new T.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending });
    const particles = new T.Points(pGeo, pMat);
    scene.add(particles);

    const recolor = () => {
      accent.set(css('--accent'));
      accent2.set(css('--accent-2'));
      tubeMat.color.copy(accent);
      tubeMat.emissive.copy(accent);
      (pen.material as THREE.MeshBasicMaterial).color.copy(accent2);
      rim.color.copy(accent2);
      for (let i = 0; i < count; i++) {
        const c = i % 2 ? accent : accent2;
        colors.set([c.r, c.g, c.b], i * 3);
      }
      pGeo.attributes['color'].needsUpdate = true;
      pMat.blending = dark() ? T.AdditiveBlending : T.NormalBlending;
      pMat.needsUpdate = true;
    };
    recolor();
    const themeObserver = new MutationObserver(recolor);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] });

    const pointer = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      pointer.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30));
      pointer.y = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30));
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onTilt, { passive: true });

    const resize = () => {
      const { width, height } = this.#host.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.position.z = camera.aspect < 0.8 ? 14 : 10.5;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(this.#host);
    resize();

    let visible = true;
    const visibility = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    visibility.observe(this.#host);

    const clock = new T.Clock();
    let frame = 0;
    const draw = () => {
      const t = clock.getElapsedTime();
      const burst = this.celebrate();
      // Signature writes over 3.2 s, holds, then rewrites.
      const cycle = (t % 6) / 3.2;
      const progress = reduced ? 1 : Math.min(1, cycle);
      tubeGeo.setDrawRange(0, Math.max(6, Math.floor(totalIndices * progress / 6) * 6));
      pen.position.copy(curve.getPointAt(Math.min(0.999, progress)));
      pen.visible = progress < 1;
      pages.forEach((p, i) => {
        const base = p.userData['base'] as THREE.Vector3;
        const phase = p.userData['phase'] as number;
        p.position.y = base.y + Math.sin(t * 0.7 + phase) * 0.12;
        p.rotation.z = (p.userData['spin'] as number) + Math.sin(t * 0.4 + phase) * 0.04 + (burst ? t * (i % 2 ? 0.6 : -0.6) : 0);
      });
      const pos = pGeo.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let y = pos.getY(i) + speeds[i] * 0.004 * (burst ? 6 : 1);
        if (y > 4.8) {
          y = -4.8;
        }
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      particles.rotation.y = t * 0.02;
      camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.04;
      camera.position.y += (-pointer.y * 0.5 + 0.2 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, -0.5);
      renderer.render(scene, camera);
    };
    const loop = () => {
      frame = requestAnimationFrame(loop);
      // Paused while a dialog is open, so the GPU is free for it.
      if (visible && !document.hidden && !document.querySelector('dialog[open]')) {
        draw();
      }
    };
    if (reduced) {
      draw();
    } else {
      loop();
    }
    canvas.classList.add('ready');

    this.#cleanup = () => {
      cancelAnimationFrame(frame);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      visibility.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onTilt);
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      });
      renderer.dispose();
    };
  }
}
