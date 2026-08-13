/**
 * Revelação por scroll — task 02 §5.
 *
 * Mecanismo único do projeto. Tasks 03–08 marcam elementos com `data-revela`
 * e não instalam observers próprios.
 *
 * Padrão herdado de modo-bim/index.html:1689 e :2059 — a media query de movimento
 * reduzido é checada ANTES de instalar o observer, não só para encurtar a duração.
 */
export function revelar(): void {
    const alvos = document.querySelectorAll<HTMLElement>('[data-revela]');
    if (alvos.length === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        alvos.forEach((el) => el.classList.add('visivel'));
        return;
    }

    const io = new IntersectionObserver(
        (entradas) => {
            for (const e of entradas) {
                if (!e.isIntersecting) continue;
                e.target.classList.add('visivel');
                io.unobserve(e.target); // revela uma vez; não re-anima ao subir
            }
        },
        { rootMargin: '0px 0px -12% 0px', threshold: 0.1 },
    );

    alvos.forEach((el) => io.observe(el));
}
