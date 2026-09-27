/**
 * Copiar para a área de transferência — task 07 §3.3.
 *
 * O botão de copiar é o caminho real do Pix: quase ninguém escaneia um QR no próprio
 * celular. O modal que o usa está em `checkout.ts` desde a task 22.
 */
export async function copiar(texto: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    } catch {
        // Fallback para browser antigo ou contexto sem permissão de clipboard.
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        document.body.removeChild(ta);
        return ok;
    }
}
