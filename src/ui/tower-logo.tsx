import Svg, { Path } from 'react-native-svg';

/** Turnuva "Gizemli Kule" logosu — ortaçağ kale kulesi: mazgallı (crenellated)
 *  tepe (4 diş), aşağı genişleyen gövde, taban plintusu, kemerli kapı + kemerli
 *  pencere (evenodd oyuk). Tek renk (accent) dolgu → emblem/accent tint'e uyar.
 *  24 viewBox, `size` ile ölçeklenir. */
export function TowerLogo({ size = 28, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d={
          // Dış silüet: plinth → gövde → mazgallı tepe (4 diş / 3 boşluk) → gövde → plinth
          'M4 22 L4 20 L5.5 20 L6.5 7.2 L4.75 7.2 L4.75 2.5 L7.25 2.5 L7.25 4.8 ' +
          'L8.75 4.8 L8.75 2.5 L11.25 2.5 L11.25 4.8 L12.75 4.8 L12.75 2.5 ' +
          'L15.25 2.5 L15.25 4.8 L16.75 4.8 L16.75 2.5 L19.25 2.5 L19.25 7.2 ' +
          'L17.5 7.2 L18.5 20 L20 20 L20 22 Z ' +
          // Kemerli kapı (oyuk)
          'M10 20 L10 15 Q12 13 14 15 L14 20 Z ' +
          // Kemerli pencere (oyuk)
          'M10.8 11 L10.8 9.3 Q12 8.2 13.2 9.3 L13.2 11 Z'
        }
      />
    </Svg>
  );
}
