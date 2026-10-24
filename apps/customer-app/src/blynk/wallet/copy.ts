import { localized } from '@/blynk/i18n/localized';
import { formatLkr } from '@/blynk/lib/money';

/**
 * Blynk Wallet words (owner, 2026-10-15: every approved refund goes to the wallet). Kept in one
 * object, in English, Sinhala and Tamil: screens read their wallet text from here, never inline.
 */
export const WALLET_COPY = localized(
  {
    title: 'Blynk Wallet',
    /** Profile row: the balance under the title. */
    rowSub: (balance: number) => formatLkr(balance),

    // the wallet screen
    balanceLabel: 'Your balance',
    howTitle: 'How it works',
    rules: [
      'Refunds for your Blynk orders are added here.',
      "Use it on your next order. It can't be withdrawn as cash.",
    ],
    maxUse: (percent: string) => `It can pay up to ${percent} of an order.`,
    paused: "Using the wallet at checkout is paused right now. Your balance is kept.",
    historyTitle: 'History',
    empty: 'No wallet activity yet',
    emptySub: 'Refunds for your orders show here.',
    orderRef: (orderNumber: string) => `Order ${orderNumber}`,
    expires: (date: string) => `Expires ${date}`,
    showMore: 'Show more',
    loadingMore: 'Loading…',
    demoNote: 'Sample wallet. Your own balance shows here once the shop is live.',
    signedOutTitle: 'Log in to see your wallet',
    signedOutSub: 'Refunds for your orders are kept in your Blynk Wallet.',
    logIn: 'Log in',
    loadFailedTitle: "Couldn't load your wallet",
    loadFailedSub: 'Check your connection and try again.',
    tryAgain: 'Try again',
    offTitle: 'Not available right now',
    offSub: "The Blynk Wallet isn't running at the moment.",

    /** History labels per ledger kind (docs/api/wallet.md §2). */
    kinds: {
      ORDER_PAYMENT: 'Paid for an order',
      ORDER_PAYMENT_RETURNED: 'Wallet payment returned',
      REFUND_ORDER_CANCELLED: 'Refund: order cancelled',
      REFUND_ITEM: 'Refund: item',
      REFUND_DELIVERY_FEE: 'Refund: delivery fee',
      ADJUSTMENT: 'Adjusted by Blynk',
      EXPIRED: 'Expired',
    } as Record<string, string>,
    kindOther: 'Wallet update',

    // checkout
    toggleLabel: (balance: number) => `Use wallet balance (${formatLkr(balance)})`,
    toggleSub: 'Pays after any coupon and points',
    payNote: (amount: number) => `${formatLkr(amount)} from your wallet on this order. The final amount is confirmed when you place it.`,
    capNote: (percent: string) => `The wallet can pay up to ${percent} of an order.`,
    cannotUse: "The wallet can't be used on this order.",
    billLine: 'Wallet',
    paidByWallet: 'Paid by wallet',
    nothingOnline: 'Your wallet covers this order. Nothing to pay online.',

    // orders
    orderBillLine: 'Paid by wallet',
    refundAdded: (amount: number) => `Refund of ${formatLkr(amount)} added to your Blynk Wallet`,
    refundsTitle: 'Refunds',
    viewWallet: 'View wallet',
    placedFromWallet: 'From your wallet',
  },
  {
    si: {
      title: 'Blynk පසුම්බිය',
      rowSub: (balance: number) => formatLkr(balance),

      balanceLabel: 'ඔබේ ශේෂය',
      howTitle: 'මෙය වැඩ කරන හැටි',
      rules: [
        'ඔබේ Blynk ඇණවුම් සඳහා ආපසු ගෙවීම් මෙයට එකතු වේ.',
        'ඔබේ ඊළඟ ඇණවුමට මෙය භාවිත කරන්න. මුදල් ලෙස ආපසු ගත නොහැක.',
      ],
      maxUse: (percent: string) => `ඇණවුමක ${percent}ක් දක්වා මෙයින් ගෙවිය හැක.`,
      paused: 'දැනට චෙක්අවුට් එකේදී පසුම්බිය භාවිතය නවතා ඇත. ඔබේ ශේෂය ආරක්ෂිතයි.',
      historyTitle: 'ඉතිහාසය',
      empty: 'පසුම්බි ගනුදෙනු තවම නැහැ',
      emptySub: 'ඔබේ ඇණවුම් සඳහා ආපසු ගෙවීම් මෙහි පෙන්වයි.',
      orderRef: (orderNumber: string) => `ඇණවුම ${orderNumber}`,
      expires: (date: string) => `${date} දිනට කල් ඉකුත් වේ`,
      showMore: 'තව පෙන්වන්න',
      loadingMore: 'පූරණය වෙමින්…',
      demoNote: 'නියැදි පසුම්බියකි. සාප්පුව ක්‍රියාත්මක වූ පසු ඔබේම ශේෂය මෙහි පෙන්වයි.',
      signedOutTitle: 'ඔබේ පසුම්බිය බැලීමට ඇතුල් වන්න',
      signedOutSub: 'ඔබේ ඇණවුම් සඳහා ආපසු ගෙවීම් ඔබේ Blynk පසුම්බියේ තබාගනී.',
      logIn: 'ඇතුල් වන්න',
      loadFailedTitle: 'ඔබේ පසුම්බිය පූරණය කළ නොහැකි වුණා',
      loadFailedSub: 'ඔබේ සම්බන්ධතාව පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      tryAgain: 'නැවත උත්සාහ කරන්න',
      offTitle: 'දැනට ලබා ගත නොහැක',
      offSub: 'Blynk පසුම්බිය දැනට ක්‍රියාත්මක නැහැ.',

      kinds: {
        ORDER_PAYMENT: 'ඇණවුමකට ගෙවූවා',
        ORDER_PAYMENT_RETURNED: 'පසුම්බි ගෙවීම ආපසු ලැබුණා',
        REFUND_ORDER_CANCELLED: 'ආපසු ගෙවීම: ඇණවුම අවලංගු කළා',
        REFUND_ITEM: 'ආපසු ගෙවීම: භාණ්ඩය',
        REFUND_DELIVERY_FEE: 'ආපසු ගෙවීම: බෙදාහැරීමේ ගාස්තුව',
        ADJUSTMENT: 'Blynk විසින් සකස් කළා',
        EXPIRED: 'කල් ඉකුත් වුණා',
      },
      kindOther: 'පසුම්බි යාවත්කාලීනය',

      toggleLabel: (balance: number) => `පසුම්බි ශේෂය භාවිත කරන්න (${formatLkr(balance)})`,
      toggleSub: 'කූපනය සහ ලකුණු පසුව ගෙවයි',
      payNote: (amount: number) => `මෙම ඇණවුමට ඔබේ පසුම්බියෙන් ${formatLkr(amount)}. අවසන් මුදල ඇණවුම තබන විට තහවුරු වේ.`,
      capNote: (percent: string) => `පසුම්බියෙන් ඇණවුමක ${percent}ක් දක්වා ගෙවිය හැක.`,
      cannotUse: 'මෙම ඇණවුමට පසුම්බිය භාවිත කළ නොහැක.',
      billLine: 'පසුම්බිය',
      paidByWallet: 'පසුම්බියෙන් ගෙවා ඇත',
      nothingOnline: 'ඔබේ පසුම්බියෙන් මෙම ඇණවුම සම්පූර්ණයෙන්ම ආවරණය වේ. ඔන්ලයින් ගෙවීමට කිසිවක් නැහැ.',

      orderBillLine: 'පසුම්බියෙන් ගෙවා ඇත',
      refundAdded: (amount: number) => `${formatLkr(amount)}ක ආපසු ගෙවීමක් ඔබේ Blynk පසුම්බියට එකතු කළා`,
      refundsTitle: 'ආපසු ගෙවීම්',
      viewWallet: 'පසුම්බිය බලන්න',
      placedFromWallet: 'ඔබේ පසුම්බියෙන්',
    },
    ta: {
      title: 'Blynk வாலெட்',
      rowSub: (balance: number) => formatLkr(balance),

      balanceLabel: 'உங்கள் இருப்பு',
      howTitle: 'இது எப்படி வேலை செய்கிறது',
      rules: [
        'உங்கள் Blynk ஆர்டர்களுக்கான ரீஃபண்டுகள் இங்கே சேர்க்கப்படும்.',
        'அடுத்த ஆர்டரில் இதைப் பயன்படுத்துங்கள். பணமாக எடுக்க முடியாது.',
      ],
      maxUse: (percent: string) => `ஒரு ஆர்டரில் ${percent} வரை இதன் மூலம் செலுத்தலாம்.`,
      paused: 'செக்அவுட்டில் வாலெட் பயன்பாடு இப்போது நிறுத்தப்பட்டுள்ளது. உங்கள் இருப்பு பாதுகாப்பாக உள்ளது.',
      historyTitle: 'வரலாறு',
      empty: 'வாலெட் செயல்பாடுகள் இன்னும் இல்லை',
      emptySub: 'உங்கள் ஆர்டர்களுக்கான ரீஃபண்டுகள் இங்கே காட்டப்படும்.',
      orderRef: (orderNumber: string) => `ஆர்டர் ${orderNumber}`,
      expires: (date: string) => `${date} அன்று காலாவதியாகும்`,
      showMore: 'மேலும் காட்டு',
      loadingMore: 'ஏற்றுகிறது…',
      demoNote: 'மாதிரி வாலெட். கடை இயங்கத் தொடங்கியதும் உங்கள் சொந்த இருப்பு இங்கே காட்டப்படும்.',
      signedOutTitle: 'உங்கள் வாலெட்டைப் பார்க்க உள்நுழையுங்கள்',
      signedOutSub: 'உங்கள் ஆர்டர்களுக்கான ரீஃபண்டுகள் உங்கள் Blynk வாலெட்டில் வைக்கப்படும்.',
      logIn: 'உள்நுழை',
      loadFailedTitle: 'உங்கள் வாலெட்டை ஏற்ற முடியவில்லை',
      loadFailedSub: 'உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
      tryAgain: 'மீண்டும் முயற்சி',
      offTitle: 'இப்போது கிடைக்காது',
      offSub: 'Blynk வாலெட் இப்போது இயங்கவில்லை.',

      kinds: {
        ORDER_PAYMENT: 'ஆர்டருக்குச் செலுத்தியது',
        ORDER_PAYMENT_RETURNED: 'வாலெட் கட்டணம் திரும்பியது',
        REFUND_ORDER_CANCELLED: 'ரீஃபண்ட்: ஆர்டர் ரத்து செய்யப்பட்டது',
        REFUND_ITEM: 'ரீஃபண்ட்: பொருள்',
        REFUND_DELIVERY_FEE: 'ரீஃபண்ட்: டெலிவரி கட்டணம்',
        ADJUSTMENT: 'Blynk சரிசெய்தது',
        EXPIRED: 'காலாவதியானது',
      },
      kindOther: 'வாலெட் புதுப்பிப்பு',

      toggleLabel: (balance: number) => `வாலெட் இருப்பைப் பயன்படுத்து (${formatLkr(balance)})`,
      toggleSub: 'கூப்பன் மற்றும் புள்ளிகளுக்குப் பிறகு செலுத்தும்',
      payNote: (amount: number) => `இந்த ஆர்டருக்கு உங்கள் வாலெட்டிலிருந்து ${formatLkr(amount)}. ஆர்டர் செய்யும்போது இறுதித் தொகை உறுதிசெய்யப்படும்.`,
      capNote: (percent: string) => `வாலெட் மூலம் ஒரு ஆர்டரில் ${percent} வரை செலுத்தலாம்.`,
      cannotUse: 'இந்த ஆர்டருக்கு வாலெட்டைப் பயன்படுத்த முடியாது.',
      billLine: 'வாலெட்',
      paidByWallet: 'வாலெட் மூலம் செலுத்தப்பட்டது',
      nothingOnline: 'உங்கள் வாலெட் இந்த ஆர்டரை முழுமையாக ஈடுசெய்கிறது. ஆன்லைனில் செலுத்த எதுவுமில்லை.',

      orderBillLine: 'வாலெட் மூலம் செலுத்தப்பட்டது',
      refundAdded: (amount: number) => `${formatLkr(amount)} ரீஃபண்ட் உங்கள் Blynk வாலெட்டில் சேர்க்கப்பட்டது`,
      refundsTitle: 'ரீஃபண்டுகள்',
      viewWallet: 'வாலெட்டைப் பார்',
      placedFromWallet: 'உங்கள் வாலெட்டிலிருந்து',
    },
  },
  'wallet.WALLET_COPY',
);
