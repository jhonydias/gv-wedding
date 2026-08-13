/**
 * Menu do site.
 *
 * `pronto` reflete se a página já existe. O site é construído por etapas (tasks 03–08) e
 * um link para uma rota inexistente é pior do que um item marcado como em construção:
 * o convidado clica, cai num 404 e não volta.
 *
 * Ao concluir cada task, virar a flag correspondente para `true`.
 */
export interface ItemNav {
    rotulo: string;
    href: string;
    pronto: boolean;
    /** Renderiza como botão sólido em vez de link de texto. */
    destaque?: boolean;
}

export const MENU: readonly ItemNav[] = [
    { rotulo: 'Início', href: '/', pronto: true },
    { rotulo: 'Nossa história', href: '/historia', pronto: false }, // task 04
    { rotulo: 'Galeria', href: '/galeria', pronto: true }, // task 05
    { rotulo: 'Presentes', href: '/presentes', pronto: true }, // task 07
    { rotulo: 'Informações', href: '/informacoes', pronto: true }, // task 08
    { rotulo: 'Confirmar presença', href: '/confirmar', pronto: true, destaque: true }, // task 06
] as const;
