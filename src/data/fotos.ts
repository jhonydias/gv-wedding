/**
 * Manifesto das fotos do pré-wedding. Task 05, renomeado na task 11.
 *
 * A ordem do array É a ordem exibida e a ordem de navegação do lightbox.
 * Curada: começa e termina forte, e afasta os quadros quase idênticos
 * (a sessão tem várias sequências do mesmo enquadramento).
 *
 * Os `alt` foram escritos um a um, olhando cada foto. `alt="foto do casal"` 35 vezes
 * é falha de aceite: é o texto que uma pessoa cega recebe no lugar da imagem.
 */
export interface Foto {
    /** Nome do arquivo em src/assets/fotos/. */
    arquivo: string;
    alt: string;
    orient: 'retrato' | 'paisagem';
}

export const FOTOS: readonly Foto[] = [
    {
        arquivo: 'gv-01-catedral-longe.jpg',
        alt: 'Gisele e Victor abraçados no meio de uma rua vazia, ao longe, com as torres góticas da catedral ao fundo',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-02-catedral-beijo.jpg',
        alt: 'O casal se beijando na mesma rua, agora de perto, com a torre da catedral desfocada atrás',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-03-danca-luzes.jpg',
        alt: 'Victor girando Gisele pela mão numa ruela estreita, sob varais de lâmpadas acesas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-04-beijo-inclinado.jpg',
        alt: 'Victor inclinando Gisele para trás num beijo, encostados na parede de pedra de um beco iluminado',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-05-porta-bar.jpg',
        alt: 'Os dois sentados juntos na entrada iluminada de um bar antigo, de frente um para o outro',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-06-fachada-bar.jpg',
        alt: 'Gisele sentada no colo de Victor num banco alto, diante da fachada de pedra do mesmo bar',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-07-caminhada-bandeirinhas.jpg',
        alt: 'O casal caminhando abraçado por uma rua decorada com bandeirinhas e luzes penduradas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-08-beijo-bandeirinhas.jpg',
        alt: 'Gisele e Victor se beijando no meio da rua, sob fileiras de bandeirinhas laranja',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-09-abraco-riso.jpg',
        alt: 'Gisele rindo enquanto Victor a abraça por trás, os dois inclinados para a frente',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-10-abraco-oculos.jpg',
        alt: 'O casal abraçado e sorrindo, ela de óculos, sob a decoração colorida da rua',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-11-rua-lanternas.jpg',
        alt: 'Os dois se beijando ao fim de uma ruela cheia de lanternas e enfeites suspensos',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-12-rua-lanternas-beijo.jpg',
        alt: 'Victor segurando Gisele pela cintura num beijo, na mesma rua de lanternas acesas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-13-abraco-frente.jpg',
        alt: 'Victor abraçando Gisele por trás, os dois sorrindo de frente para a câmera',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-14-portal-trepadeira.jpg',
        alt: 'O casal abraçado ao longe, diante de um portal antigo tomado por trepadeira',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-15-colo-beco.jpg',
        alt: 'Victor segurando Gisele no colo no meio de um beco iluminado ao entardecer',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-16-beco-luzinhas.jpg',
        alt: 'Os dois se beijando num beco estreito coberto por fios de luzinhas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-17-caminhada-maos.jpg',
        alt: 'Gisele e Victor caminhando de mãos dadas em direção à câmera, sorrindo',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-18-de-costas.jpg',
        alt: 'O casal de costas, abraçado, caminhando por uma rua de pedra ao anoitecer',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-19-abraco-lanternas.jpg',
        alt: 'Os dois abraçados sorrindo, sob lanternas e bandeirinhas de uma rua estreita',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-20-beijo-lanternas.jpg',
        alt: 'Gisele e Victor se beijando na mesma rua, com as luzes formando um corredor atrás deles',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-21-rua-luzes.jpg',
        alt: 'O casal dançando junto numa rua vazia à noite, iluminada por luminárias e vitrines',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-22-porta-madeira.jpg',
        alt: 'Retrato dos dois encostados numa grande porta de madeira antiga, olhando para a câmera',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-23-pizzaria-abraco.jpg',
        alt: 'O casal abraçado diante da vitrine iluminada de uma pizzaria, com folhas secas na calçada',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-24-pizzaria-testa.jpg',
        alt: 'Victor e Gisele de testas encostadas, sob o toldo iluminado da pizzaria',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-25-pizzaria-maos.jpg',
        alt: 'Os dois de mãos dadas caminhando pela calçada, vistos por trás de um poste desfocado',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-26-sorvete-neon.jpg',
        alt: 'Gisele e Victor se beijando com casquinhas de sorvete na mão, sob um letreiro de neon amarelo',
        orient: 'paisagem',
    },
    {
        arquivo: 'gv-27-sorvete-caminhada.jpg',
        alt: 'O casal caminhando e rindo com os sorvetes, em frente a uma sorveteria com toldos escuros',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-28-noiva-porta.jpg',
        alt: 'Gisele sozinha, de vestido branco, diante de um imenso portão de madeira trabalhada',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-29-noiva-porta-vestido.jpg',
        alt: 'Gisele posando ao lado do mesmo portão, com a fenda do vestido à mostra',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-30-luz-dourada.jpg',
        alt: 'O casal caminhando abraçado numa rua tomada por luz dourada de fim de tarde',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-31-joelho-mao.jpg',
        alt: 'Victor ajoelhado beijando a mão de Gisele, numa galeria de colunas com vasos de plantas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-32-colunata.jpg',
        alt: 'Os dois abraçados e sorrindo no centro da mesma colunata, com luzinhas no teto',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-33-fonte.jpg',
        alt: 'O casal abraçado diante de uma grande fonte monumental de pedra com esculturas douradas',
        orient: 'retrato',
    },
    {
        arquivo: 'gv-34-fonte-mureta.jpg',
        alt: 'Gisele e Victor apoiados na mureta de pedra da fonte, olhando um para o outro',
        orient: 'paisagem',
    },
    {
        arquivo: 'gv-35-retrato.jpg',
        alt: 'Retrato próximo dos dois abraçados, sorrindo largo para a câmera',
        orient: 'retrato',
    },
] as const;
