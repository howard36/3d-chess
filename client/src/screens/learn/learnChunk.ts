import { lazyChunk } from '../../lib/cachedImport';

/** The tutorial's page, loaded when it is first wanted (or a link to it is pointed at). */
export const learnScreen = lazyChunk(() => import('./LearnScreen'));
