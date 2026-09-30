import { LegalPage } from "@/src/components/legal/LegalPage";

export default function TermsRoute() {
  return <LegalPage title="Terms and conditions" intro="TrackBing helps you record food and understand estimated nutrition. These implementation terms are a draft pending review by the real operator." sections={[
    { heading: "Using TrackBing", paragraphs: [
      "Keep your account credentials private. Enter information you have permission to use, and do not use the app to access another person's diary, overload its services, or upload unlawful content. Your account's food diary and saved preferences are private to that account.",
      "TrackBing supports food searches, barcode lookup, personal foods and recipes, estimated nutrition targets, and Bee chat. API availability and account lookup limits can affect the service. The app must confirm a successful write before saying an entry was added.",
    ] },
    { heading: "Nutrition and health limitations", paragraphs: [
      "Calories, macros, barcode matches, serving conversions, database records, and AI answers may be incomplete or inaccurate. Different brands, preparations, recipes, package sizes, and markets can change the nutrition. Review the exact food and portion, and check the package label when accuracy matters.",
      "TrackBing and Bee do not provide medical advice, diagnosis, or treatment. Nutrition targets are starting estimates. Ask a qualified health professional about medical needs or whether a diet is suitable for you.",
      "A food question alone does not record that you ate it. Bee saves only a reviewed, permitted food proposal after your confirmation. A live Google Search answer by itself is not permission to create a verified diary entry or shared food record. You can use a matching independent source or your own manual label values.",
    ] },
    { heading: "Plans, renewal, and approved actions", paragraphs: [
      "Manual food, weight and goal tracking remains free on Basic. Plus provides bounded food assistance; Pro provides adaptive Bee, saved preferences and reviewed weight/goal suggestions. The Plans screen discloses current prices, monthly request/Search/token allowances, renewal period and cancellation controls. Native checkout shows the store's actual localized price. Annual subscriptions refresh AI allowances monthly, without a yearly lump sum. A lower tier retains your existing records and export/delete controls.",
      "Paid subscriptions renew through the original payment provider until cancelled there. Web users manage renewal in Plans; native users can restore/manage store purchases. Already-paid access lasts through its verified period unless revoked/refunded by the provider. The operator must approve final payment/refund/dispute terms before launch; this draft does not make up a refund guarantee.",
      "Bee's cloud AI requires an adult age setting (18 or older) and the operator's paid-service configuration. This is separate from the operator's still-pending general account eligibility decision. A proposed weight or goal update is not saved until you confirm its exact review; current body weight alone does not silently alter calorie targets.",
    ] },
    { heading: "External services and source material", paragraphs: [
      "TrackBing uses Supabase, Gemini, Google Search, USDA FoodData Central, Open Food Facts, and existing public food data, with hosting configured for Vercel. Their availability and applicable terms also affect the service. Source citations and required Search Suggestions are displayed with live Google answers.",
      "Google-grounded answers, Search Suggestions, and links are provided for the requesting user's viewing. TrackBing does not collect them into a reusable food database or a link-harvesting list. Open Food Facts records require its licensing and attribution conditions; USDA source attribution is preserved where used.",
    ] },
    { heading: "Your data and choices", paragraphs: [
      "Read the privacy policy for the current handling of account data, measurements, diary, chat, preferences, camera, local storage, and optional analytics. Chat deletion, memory deletion, and food deletion are separate actions. Clearing Bee does not erase your food history.",
      "The legal operator must finalize age eligibility, support and privacy contacts, subscriptions/payment terms if offered, dispute handling, governing law, acceptable-use enforcement, and any liability language. This draft intentionally does not invent or claim approval of those provisions.",
    ] },
    { heading: "Changes and launch review", paragraphs: [
      "The operator must publish reviewed terms and an effective date before public launch, communicate material changes, and establish a support/deletion process. This implementation draft is not legal sign-off.",
    ] },
  ]} />;
}
