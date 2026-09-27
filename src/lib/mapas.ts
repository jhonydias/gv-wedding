/**
 * Links de mapa e de corrida — task 08 §3.1.
 *
 * Tudo deriva de `EVENTO.local`. Corrigidas as coordenadas, todos os botões acertam juntos.
 */
import { EVENTO } from '../data/event';

const { lat, lng, nome, endereco } = EVENTO.local;

/** Só há coordenadas quando ambas estão preenchidas. */
export const temCoordenadas = lat !== null && lng !== null;

const destinoTexto = `${nome}, ${endereco}`;

/**
 * Universal link do Uber. No celular com o app instalado abre o app com origem e destino
 * preenchidos; sem o app cai no site; no desktop abre a web. Um único link cobre os três
 * casos — melhor que o esquema `uber://`, que não tem fallback.
 *
 * `pickup=my_location` usa a localização atual do convidado. NUNCA fixar uma origem:
 * não se sabe de onde ele sai.
 *
 * Sem coordenadas, cai para busca por endereço em texto — nunca gerar `lat=null`.
 */
export const uber = temCoordenadas
    ? 'https://m.uber.com/ul/?action=setPickup' +
      '&pickup=my_location' +
      `&dropoff[latitude]=${lat}` +
      `&dropoff[longitude]=${lng}` +
      `&dropoff[nickname]=${encodeURIComponent(nome)}` +
      `&dropoff[formatted_address]=${encodeURIComponent(endereco)}`
    : `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(
          destinoTexto,
      )}`;

export const googleMaps = temCoordenadas
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinoTexto)}`;

export const waze = temCoordenadas
    ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(destinoTexto)}&navigate=yes`;

export const appleMaps = temCoordenadas
    ? `https://maps.apple.com/?daddr=${lat},${lng}`
    : `https://maps.apple.com/?daddr=${encodeURIComponent(destinoTexto)}`;

/**
 * Busca no Google Maps por nome + endereço. Task 20, para a loja sugerida no traje.
 *
 * Busca, e não rota: o convidado vai à loja num dia qualquer, de qualquer lugar. Com o nome
 * junto, o Maps cai na ficha do estabelecimento em vez de só um pino na rua.
 */
export function buscaNoMapa(nome: string, endereco: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${nome}, ${endereco}`,
    )}`;
}
