import appJson from '../app.json';

describe('app config', () => {
  it('uses the visible app name "Gizemli Sayılar"', () => {
    expect(appJson.expo.name).toBe('Gizemli Sayılar');
  });

  it('keeps slug and identifiers ASCII-only', () => {
    const ascii = /^[\x20-\x7e]+$/;
    expect(appJson.expo.slug).toBe('gizemli-sayilar');
    expect(appJson.expo.slug).toMatch(ascii);
    expect(appJson.expo.android.package).toBe('com.gizemlisayilar.app');
    expect(appJson.expo.ios.bundleIdentifier).toBe('com.gizemlisayilar.app');
  });
});
