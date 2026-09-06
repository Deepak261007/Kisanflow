export default function Home() {
  return (
    <main className="min-h-screen bg-green-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-4xl font-bold text-green-800">
          KisanFlow
        </h1>

        <p className="mt-3 text-lg text-gray-700">
          AI-powered agriculture platform for farmers
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-green-700">
              Farmer
            </h2>
            <p className="mt-2 text-gray-600">
              Manage your crops, produce and payments.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-green-700">
              Quality Check
            </h2>
            <p className="mt-2 text-gray-600">
              Check and confirm produce quality and quantity.
            </p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            <h2 className="text-xl font-semibold text-green-700">
              Payments
            </h2>
            <p className="mt-2 text-gray-600">
              Track payment processing and completion.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}