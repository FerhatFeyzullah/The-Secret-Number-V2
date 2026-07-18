import { createContext, useContext } from 'react';

/** Alt sekme sırası (soldan sağa). Ana Ekran ortada (index 2) → açılış sayfası.
 *  TabBar'daki TAB_META bu adlarla eşleşir; pager sayfa sırası da budur. */
export const TAB_ROUTES = ['store', 'gear', 'index', 'clan', 'cup'] as const;
export type TabName = (typeof TAB_ROUTES)[number];

type TabsPagerCtx = { goToTab: (name: TabName) => void };

/** Pager sayfaları arası imperatif geçiş (ör. Donanım'daki sinyal destesinden
 *  Mağaza'ya sıçrama). Sağlayıcı: app/(tabs)/index.tsx (pager host).
 *  Ağır bağımlılığı olmayan yaprak modül → online/ui ↔ ui döngüsü oluşmaz. */
export const TabsPagerContext = createContext<TabsPagerCtx>({ goToTab: () => {} });

export const useTabsPager = () => useContext(TabsPagerContext);
