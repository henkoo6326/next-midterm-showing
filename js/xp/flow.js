/* 실행 토큰: 한 번의 체험 실행에 속한 대기·트윈·오디오를 한꺼번에 무효화한다.
 * run.cancel() 뒤에는 run.sleep / run.tween / run.wait 가 모두 Cancelled 로 reject 된다.
 * 오디오 정지는 호출하는 쪽(experience.js)이 audio.stopAll() 로 한다. */

export class Cancelled extends Error {
  constructor() { super('cancelled'); this.name = 'Cancelled'; }
}

let seq = 0;

export class Run {
  constructor() {
    this.id = ++seq;
    this.cancelled = false;
    this.timers = new Set();
    this.frames = new Set();
    this.rejecters = new Set();
    this.cleanups = new Set();
  }

  check() { if (this.cancelled) throw new Cancelled(); }

  /* 취소 가능한 대기 */
  sleep(ms) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.rejecters.delete(reject);
        resolve();
      }, Math.max(0, ms));
      this.timers.add(timer);
      this.rejecters.add(reject);
    });
  }

  /* 다른 promise 를 이 실행에 묶는다(취소되면 reject) */
  wait(promise) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      this.rejecters.add(reject);
      Promise.resolve(promise).then(value => {
        this.rejecters.delete(reject);
        if (this.cancelled) reject(new Cancelled()); else resolve(value);
      }, error => {
        this.rejecters.delete(reject);
        reject(this.cancelled ? new Cancelled() : error);
      });
    });
  }

  /* duration 동안 매 프레임 fn(e) (e: 이징 적용 0→1). 끝나면 fn(1) 보장 */
  tween(duration, fn, easing = t => t) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
      const start = performance.now();
      this.rejecters.add(reject);
      const step = now => {
        this.frames.delete(handle);
        if (this.cancelled) return;
        const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
        try { fn(easing(t), t); } catch (err) { this.rejecters.delete(reject); reject(err); return; }
        if (t >= 1) { this.rejecters.delete(reject); resolve(); return; }
        handle = requestAnimationFrame(step);
        this.frames.add(handle);
      };
      let handle = requestAnimationFrame(step);
      this.frames.add(handle);
    });
  }

  /* 취소될 때 실행할 정리 함수 */
  onCancel(fn) { this.cleanups.add(fn); return () => this.cleanups.delete(fn); }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const t of this.timers) clearTimeout(t);
    for (const f of this.frames) cancelAnimationFrame(f);
    this.timers.clear();
    this.frames.clear();
    const rejecters = [...this.rejecters];
    this.rejecters.clear();
    for (const r of rejecters) { try { r(new Cancelled()); } catch { /* noop */ } }
    for (const fn of this.cleanups) { try { fn(); } catch (err) { console.error(err); } }
    this.cleanups.clear();
  }
}

export const isCancelled = err => err && err.name === 'Cancelled';
