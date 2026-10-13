import logo from '../assets/logo-mark.png';

export function isDesktopBlocked(width: number, search: string): boolean {
  if (new URLSearchParams(search).get('desktop') === '1') return false;
  return width >= 900;
}

export default function PhoneOnly() {
  return (
    <div className="phone-only">
      <div>
        <img src={logo} alt="" width={72} style={{ margin: '0 auto' }} />
        <h1>Blynk is a phone app</h1>
        <p>Groceries delivered in Dharga Town and its 4 km surroundings. Open blynk.lk on your phone and tap Get Blynk.</p>
      </div>
    </div>
  );
}
