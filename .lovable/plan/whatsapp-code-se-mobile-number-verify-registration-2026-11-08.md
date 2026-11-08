# WhatsApp code se mobile number verify (Registration)

## User ko kya dikhega

1. Registration form mein mobile number ke saath **"Verify"** button.
2. Click karne par message: "Check your WhatsApp and enter 6 digit code" aur ek **code wala box**.
3. User code likh kar **"Confirm"** dabaye. Sahi code par number ke saath green tick "Verified" aa jaye. Ghalat code par "Code ghalat hai" dikhe.
4. Registration tab tak complete nahi hogi jab tak number verified na ho.

## Admin ko kya dikhega (Admin panel mein naya "Phone Verification" hissa)

- **WhatsApp number**: admin apna number yahan set kare. User ko bataya jaye ke code is number se aayega.
- **100 codes ki list**: "Generate 100 codes" button (6 digit random), list dekh sakte hain, purane/used codes ki ginti, dobara generate kar sakte hain.
- **Pending requests**: har request mein user ka number aur waqt. **"Send code"** dabane par:
  - list mein se ek random unused code chuna jaye,
  - Firebase mein yaad rakha jaye ke ye code is number ko bheja gaya (waqt ke saath),
  - admin ke phone par WhatsApp khule, user ke number par message pehle se likha ho: "Travel Sync verification code: 123456". Admin bas send dabaye.
- Verified / expired requests ki history.

## Rules

- Code 15 minute tak valid. Uske baad user dobara "Verify" dabaye.
- Ek code sirf ek dafa use ho; use hone ke baad list mein "used" ho jaye.
- 5 ghalat koshishon ke baad request band; nayi request karni hogi.
- Code user ke phone/browser ko  kabhi nazar nahi aata — sirf WhatsApp se milta hai. Firebase khud check karta hai ke likha hua code sahi hai.

## Technical details

- Firestore collections:
  - `settings` mein `otpWhatsapp` (admin number).
  - `otpPool/main` { codes: [{code, used}] } — sirf admin read/write.
  - `otpRequests/{phoneDigits}` { phone, uid, status: pending|sent|verified|expired, createdAt, attempts } — user apna request bana sake, admin sab dekhe.
  - `otpSecrets/{phoneDigits}` { code, sentAt } — sirf admin likhe, koi client read na kar sake.
  - `verifiedPhones/{phoneDigits}` { uid, code, verifiedAt } — create rule: `request.resource.data.code == get(/otpSecrets/$(phone)).data.code` aur sentAt 15 min ke andar. Rules secret ko check karti hain bina user ko dikhaye.
  - Ghalat koshish par client `attempts` badhata hai; rule attempts < 5 hone par hi verify allow kare.
- Registration submit par check: `verifiedPhones/{phone}.uid == current uid`; profile mein `phoneVerified: true`.
- Send code: admin client random unused code chune, ek batch mein `otpSecrets`, `otpPool` (used) aur `otpRequests.status=sent` likhe, phir `https://wa.me/<userDigits>?text=...` khole.
- `firestore.rules` naye collections ke liye update; nayi `AdminOtp` component admin page mein; registration mein `PhoneVerify` component.
- Code chunne aur expiry/attempt logic ke chhote tests.
- Automatic (bina admin click) bhejna baad mein WhatsApp Business API se add ho sakta hai.