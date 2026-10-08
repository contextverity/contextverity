/*
 * Copyright The ContextVerity Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// @ts-check

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('contextverity_receipts', table => {
    table.comment('Authoritative, immutable context receipts');
    table.string('receipt_id', 64).primary().notNullable();
    table.string('issuer', 255).notNullable();
    table.string('consumer', 255).notNullable().index();
    table.string('subject', 255).notNullable().index();
    table.string('purpose', 64).notNullable();
    table.string('classification', 16).notNullable();
    // ISO-8601 UTC strings sort lexicographically in time order.
    table.string('issued_at', 32).notNullable().index();
    table.string('valid_until', 32).notNullable();
    table.text('body').notNullable();
    table.string('integrity', 128).notNullable();
  });
  await knex.schema.createTable('contextverity_verifications', table => {
    table.comment('Append-only verification results');
    table.increments('id').primary();
    table
      .string('receipt_id', 64)
      .notNullable()
      .references('receipt_id')
      .inTable('contextverity_receipts')
      .onDelete('CASCADE');
    table.string('verified_at', 32).notNullable();
    table.string('verdict', 16).notNullable();
    table.text('body').notNullable();
    table.index(['receipt_id', 'id']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('contextverity_verifications');
  await knex.schema.dropTable('contextverity_receipts');
};
