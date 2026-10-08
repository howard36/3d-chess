// ENV PREVIEW (temporary): the link the menu's Copy link copies.

/** The page's address with this `env` list, for a link to share (a game's page becomes /computer). */
export const envLink = (
  where: Pick<Location, 'origin' | 'pathname' | 'search'>,
  query: string,
): string => {
  const path = /^\/(game|computer)\/./.test(where.pathname) ? '/computer' : where.pathname;
  const params = new URLSearchParams(where.search);
  params.delete('env');
  const rest = params.toString();
  return `${where.origin}${path}?${rest ? `${rest}&` : ''}env=${query}`;
};
