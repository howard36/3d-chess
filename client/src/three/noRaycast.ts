/**
 * Opts a decorative object out of raycasting. Line raycasting has a generous
 * default threshold that would steal pointer events from the cells, and
 * nothing drawn for looks should ever take a click.
 */
export const noRaycast = () => null;
