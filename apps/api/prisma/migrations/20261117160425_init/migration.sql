-- CreateEnum
CREATE TYPE "Role" AS ENUM ('traveler', 'controller', 'admin');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('scheduled', 'cancelled');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('valid', 'used', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'traveler',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "seat_count" INTEGER NOT NULL,
    "layout" JSONB NOT NULL,

    CONSTRAINT "buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "bus_id" UUID NOT NULL,
    "departure_at" TIMESTAMPTZ(3) NOT NULL,
    "price_fcfa" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "total_fcfa" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "passenger_name" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'valid',
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "routes_origin_destination_key" ON "routes"("origin", "destination");

-- CreateIndex
CREATE UNIQUE INDEX "buses_name_key" ON "buses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "trips_route_id_departure_at_key" ON "trips"("route_id", "departure_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_user_id_idempotency_key_key" ON "bookings"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tickets_booking_id_idx" ON "tickets"("booking_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_bus_id_fkey" FOREIGN KEY ("bus_id") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Ajouté à la main : Prisma ne sait déclarer ni les index partiels ni les CHECK.
-- ============================================================================

-- LA garantie anti double vente : au plus un billet non annulé par (trajet, place).
-- Partiel pour qu'un billet annulé libère la place (revente possible) tout en restant dans l'historique.
CREATE UNIQUE INDEX "tickets_one_active_per_seat"
  ON "tickets" ("trip_id", "seat_number")
  WHERE "status" <> 'cancelled';

ALTER TABLE "buses"   ADD CONSTRAINT "buses_seat_count_positive"   CHECK ("seat_count" > 0);
ALTER TABLE "trips"   ADD CONSTRAINT "trips_price_non_negative"    CHECK ("price_fcfa" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_non_negative" CHECK ("total_fcfa" >= 0);
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_seat_number_positive" CHECK ("seat_number" > 0);
