/**
 * US-11 · Arma una página del historial a partir de lo que devolvió Firestore.
 * La consulta pide `limite + 1` documentos del más nuevo al más viejo: si llega el de sobra,
 * quedan mensajes más viejos (hayMas). La página se entrega del más viejo al más nuevo.
 */
export function armarPagina<T>(delMasNuevoAlMasViejo: T[], limite: number): { items: T[]; hayMas: boolean } {
  return {
    items: delMasNuevoAlMasViejo.slice(0, limite).reverse(),
    hayMas: delMasNuevoAlMasViejo.length > limite,
  };
}
