export type ChapterFrame = Readonly<{time:number;scrollY:number;trackX:number;changed:boolean;stacked:boolean}>;

/** CSS owns every scene rectangle; this controller only choreographs the chapters. */
export class ScrollStudio {
  private section = document.querySelector<HTMLElement>('#work')!;
  private stage = document.querySelector<HTMLElement>('.work-stage')!;
  private track = document.querySelector<HTMLElement>('.studio-track')!;
  private studies = Array.from(document.querySelectorAll<HTMLElement>('.study'));
  private buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-study-index]'));
  private current = -1;
  private lastTrackX = NaN;
  private lastStacked = false;
  private observer: ResizeObserver;
  private lifetime = new AbortController();
  constructor(private reduced: () => boolean, private navigate: (top:number) => void) {
    this.buttons.forEach((button, index) => button.addEventListener('click', () => {
      if (this.stacked()) this.navigate(this.studies[index].getBoundingClientRect().top+scrollY);
      else {
        const top = this.section.getBoundingClientRect().top + scrollY;
        const travel = this.section.offsetHeight - innerHeight;
        this.navigate(top + travel * index / 2);
      }
    }, { signal: this.lifetime.signal }));
    this.observer = new ResizeObserver(() => {
      if (Array.from(document.querySelectorAll<HTMLElement>('.study-description')).some(copy => copy.getBoundingClientRect().height > 110)) document.documentElement.classList.add('content-expanded');
    });
    document.querySelectorAll('.study-description').forEach(copy => this.observer.observe(copy));
    this.update();
  }
  update(time = performance.now()): ChapterFrame {
    const reduced = this.stacked();
    const rect = this.section.getBoundingClientRect();
    const progress = Math.min(2, Math.max(0, -rect.top / Math.max(1, rect.height - innerHeight) * 2));
    // One subpixel value; layout positioning keeps the horizontal DOM move in the
    // same main-thread frame as the sticky canvas. No CSS/JS secondary easing.
    const trackX = reduced ? 0 : -progress * this.stage.clientWidth;
    const changed = trackX !== this.lastTrackX || reduced !== this.lastStacked;
    if (changed) { this.track.style.left = `${trackX}px`; this.track.style.transform = ''; }
    this.lastTrackX = trackX; this.lastStacked = reduced;
    const index = reduced ? Math.max(0, this.studies.findIndex(item => item.getBoundingClientRect().bottom > innerHeight * .5)) : Math.round(progress);
    if (index !== this.current || reduced) {
      this.current = index;
      this.buttons.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
      this.studies.forEach((study, i) => {
        study.inert = !reduced && i !== index;
        if (reduced) study.removeAttribute('aria-hidden');
        else study.setAttribute('aria-hidden', String(i !== index));
      });
      document.querySelector('.work-current')!.textContent = String(index + 1).padStart(2, '0');
    }
    document.documentElement.style.setProperty('--chapter', String(progress));
    return Object.freeze({time,scrollY:-document.documentElement.getBoundingClientRect().top,trackX,changed,stacked:reduced});
  }
  private stacked() { return this.reduced() || document.documentElement.classList.contains('content-expanded'); }
  destroy() { this.lifetime.abort(); this.observer.disconnect(); }
}
