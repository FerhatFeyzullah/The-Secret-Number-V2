import { createContext, useContext } from 'react';

/** Vavizof açılış intro'su tamamlandı mı? Welcome gibi modallar (native <Modal>,
 *  JS-overlay intro'nun ÜSTÜNE çizilir) intro bitmeden AÇILMAMALI; tüketici bu
 *  bayrağa bakar. Kök layout intro `onDone`'da true'ya çeker. */
export const IntroDoneContext = createContext(false);

export const useIntroDone = () => useContext(IntroDoneContext);
