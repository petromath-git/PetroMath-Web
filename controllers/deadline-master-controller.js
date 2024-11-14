const dbMapping = require("../db/ui-db-field-mapping")
const dateFormat = require('dateformat');
const utils = require("../utils/app-utils");
const config = require("../config/app-config");
const DeadlineDao = require("../dao/deadline-master-dao");

module.exports = {
    getDeadlineData: (req, res) => {
        let locationCode = req.user.location_code;
       
        Promise.allSettled([
            getDeadlineDataPromise(locationCode),
            getLocationId(locationCode),
            getDeadlineTypePromise(),
          
            ])
        .then((values) => {
        res.render('deadline',{user: req.user,
            title:'Deadline Master',
            config: config.APP_CONFIGS,
            currentDate: utils.currentDate(),
            locationcode: locationCode,
            deadlinesList: values[0].value.deadlines,
            location_id: values[1].value.location_id,
            deadlineTypes:values[2].value,
           
            });
        });
    },
    saveDeadlineData: (req, res, next) => {
       DeadlineDao.create(dbMapping.newDeadlineData(req));
        res.redirect('/deadline');
    },

    updateDeadlineData: (req, res) => {
        DeadlineDao.update({
            t_deadline_id: req.params.id,
            deadline_date: req.body.deadlineDate,
            purpose: req.body.purpose,
            warning_day:req.body.warningDay,
            hard_stop:req.body.hardStop,
            closed:req.body.closed,
            comment: req.body.comment
        }).then(data => {
            if(data == 1 || data == 0) {
                res.status(200).send({message: 'Saved deadline data successfully.'});
            } else {
                res.status(500).send({error: 'Error while saving data.'});
            }
        });
    }
}
const getDeadlineDataPromise = (locationCode) => {
    return new Promise((resolve, reject) => {
        let deadlines = [];
        DeadlineDao.findDeadlines(locationCode)
            .then(data => {
                data.forEach((deadline) => {
                    deadlines.push({
                        deadlineId: deadline.t_deadline_id,
                        deadlineDate: deadline.deadline_date,
                        purpose: deadline.purpose,
                        warningDay: deadline.warning_day,
                        hardStop: deadline.hard_stop,
                        closed: deadline.closed,
                        comment:deadline.comment,
                       
                    });
                });
            resolve({deadlines: deadlines});
                   
        });
        
    });
}

const getLocationId = (locationCode) => {
    return new Promise((resolve, reject) => {
        let location_id;
        DeadlineDao.getLocationId(locationCode)
            .then(data => {
               location_id = data.location_id;
                resolve({location_id:location_id});
            });

    });
}

const getDeadlineTypePromise = () => {
    return new Promise((resolve, reject) => {
        let deadlineTypes = [];
        DeadlineDao.getDeadlineType()
                .then(data => {
                    data.forEach((etype) => {
                        deadlineTypes.push({
                            id: etype.lookup_id,
                            type: etype.description,
                    
                    });
                });
                //let productMap = new Map();
                resolve(deadlineTypes);
            });
    });
}