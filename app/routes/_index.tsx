import { Link } from "@remix-run/react";

export default function Index() {
  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold mb-4 text-center text-blue-700">
        🛒 ZM Store POS
      </h1>

      <p className="text-center text-gray-700">
        Welcome! This is your Point-of-Sale System.
      </p>

      <div className="text-center mt-6">
        <Link
          to="/products"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded shadow"
        >
          View Products
        </Link>
      </div>
    </main>
  );
}
