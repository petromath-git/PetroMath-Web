const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

const TxnDeadline = db.txn_deadline;
const Location = db.location;
const Lookup = db.lookup;

module.exports = {
  findDeadlines: (locationCode) => {
    return TxnDeadline.findAll({
      attributes: [
        "t_deadline_id",
        "deadline_date",
        "purpose",
        "warning_day",
        "hard_stop",
        "closed",
        "comment",
        "location_id",
      ],
      include: [
        {
          model: Location,
          attributes: ["location_id"],
          where: { location_code: locationCode },          
          required: true,
        },
      ],
      order: [Sequelize.literal('deadline_date')],
    });
  },

  getLocationId: (locationCode) => {
    return Location.findOne({
      attributes: ["location_id"],
      where: { location_code: locationCode },
    });
  },
  getDeadlineType: () => {
    return Lookup.findAll({
      attributes: ["lookup_id", "description"],
      where: { lookup_type: "Deadline" },
    });
  },

  create: (deadline) => {
    return TxnDeadline.create(deadline);
  },
  update: (deadline) => {
    return TxnDeadline.update(
      {
        deadline_date: deadline.deadline_date,
        purpose: deadline.purpose,
        warning_day: deadline.warning_day,
        hard_stop: deadline.hard_stop,
        closed: deadline.closed,
        comment: deadline.comment,
      },
      {
        where: { t_deadline_id: deadline.t_deadline_id },
      }
    );
  },
};
