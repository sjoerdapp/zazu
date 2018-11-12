/*Copyright 2018 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.*/

const express = require('express');
const router = express.Router();

const passport = require('passport');
const BigQuery = require('@google-cloud/bigquery');

const bigquery = new BigQuery();
const async = require('async');

var User = require('../models/user');
var Organization = require('../models/organization');
var Report = require('../models/report');
var Rule = require('../models/rule');
var Permission = require('../models/permission');

var utils = require('../utilities/utils');
var config = require('../utilities/config');

router.get('/logout', function(req, res) {
  req.session.destroy();
  res.send({ status: '200', message: 'User logged out' });
});

router.get('/getAllUsers', function(req, res) {
  User.find(function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'User list retrieved error.' });
    }
    res.send(docs);
  });
});

router.get('/getAllUsers/:id', function(req, res) {
  User.findOne({ _id: req.params.id }, function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'User list retrieved error.' });
    }
    res.send(docs);
  });
});

router.get('/getUsersByOrganization/:id', function(req, res) {
  var usersByOrg = [];

  User.find(function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'User list retrieved error.' });
    } else {
      for (var i = 0; i < docs.length; i++) {
        for (var j = 0; j < docs[i].organizations[j]; j++) {
          if (docs[i].organizations[j].id == req.params.id) {
            usersByOrg.push({
              _id: docs[i]._id,
              firstName: docs[i].firstName,
              lastName: docs[i].lastName,
              organizations: docs[i].organizations,
              role: docs[i].role
            });
          }
        }
      }
      res.send(usersByOrg);
    }
  });
});

router.post('/createNewUser', function(req, res) {
  var newUser = req.body;

  User.create(newUser, function(err, results) {
    var newUserId = results._id;

    if (err) {
      res.send({ status: '500', message: err.message });
    } else {
      var addNewUser =
        'INSERT INTO `' +
        config.bq_instance +
        '.' +
        config.bq_dataset +
        '.users_2` (user_id, googleID, role) VALUES ("' +
        newUserId +
        '", "' +
        newUser.googleID +
        '", "' +
        newUser.role +
        '")';

      bigquery
        .createQueryStream(addNewUser)
        .on('error', function(err) {
          res.send({ status: '500', message: err.message });
        })
        .on('data', function(data) {})
        .on('end', function() {
          if (newUser.role === 'admin') {
            var findAllOrgs =
              'SELECT organization_id FROM `' +
              config.bq_instance +
              '.' +
              config.bq_dataset +
              '.vendors_2`';

            bigquery
              .createQueryStream(findAllOrgs)
              .on('error', function(err) {
                res.send({ status: '500', message: err.message });
              })
              .on('data', function(data) {
                var addNewAdminVendor =
                  'INSERT INTO `' +
                  config.bq_instance +
                  '.' +
                  config.bq_dataset +
                  '.user_vendor_roles_2` (user_id, organization_id) VALUES ("' +
                  newUserId +
                  '", "' +
                  data.organization_id +
                  '")';

                bigquery
                  .createQueryStream(addNewAdminVendor)
                  .on('error', function(err) {
                    res.send({ status: '500', message: err.message });
                  })
                  .on('data', function(data) {})
                  .on('end', function() {});
              })
              .on('end', function() {
                var orgList = [];

                Organization.find(function(err1, docs) {
                  if (err1) {
                    res.send({ status: '500', message: err1.message });
                  } else {
                    for (var i = 0; i < docs.length; i++) {
                      orgList.push({ _id: docs[i]._id, name: docs[i].name });
                    }

                    User.updateOne(
                      { _id: newUserId },
                      { organizations: orgList },
                      function(err2, res2) {
                        if (err2) {
                          res.send({ status: '500', message: err2.message });
                        } else {
                          res.send({ status: '200', userID: newUserId });
                        }
                      }
                    );
                  }
                });
              });
          } else {
            var findOrgIds =
              'SELECT organization_id FROM `' +
              config.bq_instance +
              '.' +
              config.bq_dataset +
              '.vendors_2` WHERE organization IN (';

            for (var i = 0; i < newUser.organizations.length - 1; i++) {
              findOrgIds += '"' + newUser.organizations[i].name + '", ';

              Organization.updateOne(
                { name: newUser.organizations[i].name },
                { $inc: { usersCount: 1 } },
                function(err1, res1) {
                  if (err1) {
                    res.send({ status: '500', message: err1.message });
                  }
                }
              );
            }
            findOrgIds +=
              '"' +
              newUser.organizations[newUser.organizations.length - 1].name +
              '")';
            Organization.updateOne(
              {
                name:
                  newUser.organizations[newUser.organizations.length - 1].name
              },
              { $inc: { usersCount: 1 } },
              function(err1, res1) {
                if (err1) {
                  res.send({ status: '500', message: err1.message });
                }
              }
            );

            bigquery
              .createQueryStream(findOrgIds)
              .on('error', function(err) {
                res.send({ status: '500', message: err.message });
              })
              .on('data', function(data) {
                var addNewAdminVendor =
                  'INSERT INTO `' +
                  config.bq_instance +
                  '.' +
                  config.bq_dataset +
                  '.user_vendor_roles_2` (user_id, organization_id) VALUES ("' +
                  newUserId +
                  '", "' +
                  data.organization_id +
                  '")';

                bigquery
                  .createQueryStream(addNewAdminVendor)
                  .on('error', function(err) {
                    res.send({ status: '500', message: err.message });
                  })
                  .on('data', function(data) {})
                  .on('end', function() {});
              })
              .on('end', function() {
                res.send({ status: '200', userID: newUserId });
              });
          }
        });
    }
  });
});

router.post('/deleteUser', function(req, res) {
  var deleteUser = req.body;

  User.deleteOne({ _id: deleteUser._id }, function(err, results) {
    if (err) {
      res.send({ status: '500', message: err.message });
    } else {
      var deleteUserQuery =
        'DELETE FROM `' +
        config.bq_instance +
        '.' +
        config.bq_dataset +
        '.users_2` WHERE user_id = "' +
        deleteUser._id +
        '"';

      bigquery
        .createQueryStream(deleteUserQuery)
        .on('error', function(err) {
          res.send({ status: '500', message: err.message });
        })
        .on('data', function(data) {})
        .on('end', function() {
          var deleteUserVendor =
            'DELETE FROM `' +
            config.bq_instance +
            '.' +
            config.bq_dataset +
            '.user_vendor_roles_2` WHERE user_id = "' +
            deleteUser._id +
            '"';

          bigquery
            .createQueryStream(deleteUserVendor)
            .on('error', function(err) {
              res.send({ status: '500', message: err.message });
            })
            .on('data', function(data) {})
            .on('end', function() {
              var deleteCurrentVendorView =
                'DELETE FROM `' +
                config.bq_instance +
                '.' +
                config.bq_dataset +
                '.user_current_vendor_2` WHERE user_id = "' +
                deleteUser._id +
                '"';

              bigquery
                .createQueryStream(deleteCurrentVendorView)
                .on('error', function(err) {
                  res.send({ status: '500', message: err.message });
                })
                .on('data', function(data) {})
                .on('end', function() {
                  if (deleteUser.role === 'viewer') {
                    for (var i = 0; i < deleteUser.organizations.length; i++) {
                      Organization.updateOne(
                        { _id: deleteUser.organizations[i]._id },
                        { $inc: { usersCount: -1 } },
                        function(err1, res1) {
                          if (err1) {
                            res.send({ status: '500', message: err1.message });
                          }
                        }
                      );
                    }
                    res.send({ status: '200', userID: deleteUser._id });
                  } else {
                    res.send({ status: '200', userID: deleteUser._id });
                  }
                });
            });
        });
    }
  });
});

router.post('/editUser', function(req, res) {
  // TODO: when googleID is edited, report sharing needs to be updated.

  var editUser = req.body;

  var updateUser = 'UPDATE `' + config.bq_instance + '.' + config.bq_dataset + '.users_2` SET googleID = "' + editUser.googleID + '" WHERE user_id = "' + editUser._id + '"';

  bigquery
    .createQueryStream(updateUser)
    .on('error', function(err) {
      res.send({ status: '500', message: err.message });
    })
    .on('data', function(data) {})
    .on('end', function() {
      User.updateOne({ _id: editUser._id }, editUser, function(err, result) {
        if (err) {
          res.send({
            status: '500',
            message: 'User failed to update.'
          });
        }
        res.send({ status: '200', results: result });
      });
    });
});

router.get('/getAllOrganizations', function(req, res) {
  Organization.find(function(err, docs) {
    if (err) {
      res.send({
        status: '500',
        message: 'Organization list retrieved error.'
      });
    }
    res.send(docs);
  });
});

router.get('/getAllOrganizationsWithNoDetails', function(req, res) {
  var orgsNoDetails = [];

  Organization.find(function(err, docs) {
    if (err) {
      res.send({
        status: '500',
        message: 'Organization list retrieved error.'
      });
    }

    for (var i = 0; i < docs.length; i++) {
      orgsNoDetails.push({ _id: docs[i]._id, name: docs[i].name });
    }
    res.send(orgsNoDetails);
  });
});

router.get('/getOrganizationById/:orgid', function(req, res) {
  Organization.findOne({ _id: req.params.orgid }, function(err, docs) {
    if (err) {
      res.send({
        status: '500',
        message: 'Organization list retrieved error.'
      });
    }
    res.send(docs);
  });
});

router.post('/createOrganization', function(req, res) {
  var newOrg = req.body;
  newOrg.reportsCount = 0;
  newOrg.usersCount = 0;
  newOrg.datarulesCount = 0;

  Organization.create(newOrg, function(err, results) {
    var newOrgId = results._id;

    if (err) {
      res.send({ status: '500', message: err.message });
    } else {
      var insertRow =
        'INSERT INTO `' +
        config.bq_instance +
        '.' +
        config.bq_dataset +
        '.vendors_2` (organization_id, organization) VALUES ("' +
        newOrgId +
        '","' +
        newOrg.name +
        '")';

      bigquery
        .createQueryStream(insertRow)
        .on('error', function(err) {
          res.send({ status: '500', message: err.message });
        })
        .on('data', function(data) {})
        .on('end', function() {
          var retailerIdList = [];
          var getRetailerIds =
            'SELECT user_id FROM `' +
            config.bq_instance +
            '.' +
            config.bq_dataset +
            '.users_2` WHERE role = "admin"';

          bigquery
            .createQueryStream(getRetailerIds)
            .on('error', function(err) {
              res.send({ status: '500', message: err.message });
            })
            .on('data', function(data) {
              var user_id = data.user_id;
              var addRetailerAccesses =
                'INSERT INTO `' +
                config.bq_instance +
                '.' +
                config.bq_dataset +
                '.user_vendor_roles_2` (user_id, organization_id) VALUES ("' +
                user_id +
                '", "' +
                newOrgId +
                '")';

              bigquery
                .createQueryStream(addRetailerAccesses)
                .on('error', function(err) {
                  res.send({ status: '500', message: err.message });
                })
                .on('data', function(data) {})
                .on('end', function() {
                  User.updateOne(
                    { _id: user_id },
                    {
                      $push: {
                        organizations: { _id: newOrgId, name: newOrg.name }
                      }
                    },
                    function(err, res1) {
                      if (err) {
                        console.log(err);
                        res.send({ status: '500', message: err.message });
                      }
                    }
                  );
                });
            })
            .on('end', function() {
              res.send({ status: '200', orgID: newOrgId });
            });
        });
    }
  });
});

router.post('/deleteOrganization', function(req, res) {
  var orgDelete = req.body;

  Organization.deleteOne({ _id: orgDelete._id }, function(err, results) {
    if (err) {
      res.send({ status: '500', message: err.message });
    } else {
      var delOrg =
        'DELETE FROM `' +
        config.bq_instance +
        '.' +
        config.bq_dataset +
        '.vendors_2` WHERE organization_id = "' +
        orgDelete._id +
        '"';

      bigquery
        .createQueryStream(delOrg)
        .on('error', function(err) {
          res.send({ status: '500', message: err.message });
        })
        .on('data', function(data) {})
        .on('end', function() {
          var delCurrentVendorView =
            'DELETE FROM `' +
            config.bq_instance +
            '.' +
            config.bq_dataset +
            '.user_current_vendor_2` WHERE organization_id = "' +
            orgDelete._id +
            '"';

          bigquery
            .createQueryStream(delCurrentVendorView)
            .on('error', function(err) {
              res.send({ status: '500', message: err.message });
            })
            .on('data', function(data) {})
            .on('end', function() {
              var delUserVendor =
                'DELETE FROM `' +
                config.bq_instance +
                '.' +
                config.bq_dataset +
                '.user_vendor_roles_2` WHERE organization_id = "' +
                orgDelete._id +
                '"';

              bigquery
                .createQueryStream(delUserVendor)
                .on('error', function(err) {
                  res.send({ status: '500', message: err.message });
                })
                .on('data', function(data) {})
                .on('end', function() {
                  User.updateMany(
                    {
                      organizations: {
                        $elemMatch: { _id: orgDelete._id, name: orgDelete.name }
                      }
                    },
                    {
                      $pull: {
                        organizations: {
                          _id: orgDelete._id,
                          name: orgDelete.name
                        }
                      }
                    },
                    function(err, res1) {
                      if (err) {
                        console.log(err);
                        res.send({ status: '500', message: err.message });
                      } else {
                        res.send({ status: '200', results: results });
                      }
                    }
                  );
                });
            });
        });
    }
  });
});

router.post('/editOrganization', function(req, res) {

  var editOrg = req.body;

  Organization.updateOne({ _id : editOrg._id }, editOrg, function(err, result) {
    if (err) {
      res.send({ status: '500', message: 'Organization failed to update.' });
    } else {
      res.send({ status: '200', result: result });
    }
  });

});

router.get('/getAllReports', function(req, res) {
  Report.find(function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'Report list retrieved error.' });
    } else {
      res.send(docs);
    }
  });
});

router.get('/getAllReports/:id', function(req, res) {
  Report.findOne({ _id: req.params.id }, function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'Report list retrieved error.' });
    }
    res.send(docs);
  });
});

router.get('/getReportByOrganization/:id', function(req, res) {
  var reportsByOrg = [];

  Report.find(function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'Report list retrieved error.' });
    } else {
      for (var i = 0; i < docs.length; i++) {
        for (var j = 0; j < docs[i].organizations.length; j++) {
          if (docs[i].organizations[j]._id === req.params.id) {
            reportsByOrg.push(docs[i]);
          }
        }
      }
      res.send(reportsByOrg);
    }
  });
});

router.get('/getReportByUser/:id', function(req, res) {
  var reportsByUser = [];

  User.find({ _id: req.params.id }, function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'User retrieved error.' });
    } else {
      var userOrgList = docs[0].organizations;

      Report.find(function(err, reports) {
        if (err) {
          res.send({ status: '500', message: 'Report list retrieved error.' });
        } else {
          for (var i = 0; i < reports.length; i++) {
            for (var k = 0; k < reports[i].organizations.length; k++) {
              for (var j = 0; j < userOrgList.length; j++) {
                if (userOrgList[j]._id == reports[i].organizations[k]._id) {
                  reportsByUser.push(reports[i]);
                }
              }
            }
          }
          res.send(reportsByUser);
        }
      });
    }
  });
});

router.get('/getUserView/:user', function(req, res) {

  var userObj = req.params.user;
  var viewExists = "-1";

  User.find({ _id: userObj._id }, function(err1, res1){
      if (err1) {
        res.send({ status: '500', message: 'Retrieving ghost view error.' });
      }

      var orgId = res1[0].organization._id;

      var findViewRow = 'SELECT organization_id FROM `' + config.bq_instance + '.' + config.bq_dataset + '.user_current_vendor` WHERE user_id = ' + userObj._id;

      bigquery.createQueryStream(findViewRow)
          .on('error', function(err) {
             res.send({"status": "500", "message": err.message });
          })
          .on('data', function(row) {

              viewExists = row.organization_id;

          })
          .on('end', function() {

            if (viewExists == "-1") {
                var insertOrUpdateView = 'INSERT INTO `' + config.bq_instance + '.' + config.bq_dataset + '.user_current_vendor` (user_id, organization_id) VALUES (' + userObj._id + ', ' + userObj.organization._id + ')';
            }
            else {
                var insertOrUpdateView = 'UPDATE `' + config.bq_instance + '.' + config.bq_dataset + '.user_current_vendor` SET organization_id = ' + userObj.organization._id + ' WHERE user_id = ' + userObj._id;
            }

            bigquery.createQueryStream(insertOrUpdateView)
                .on('error', function(err) {
                   res.send({"status": "500", "message": err.message });
                })
                .on('data', function(data) {

                })
                .on('end', function() {

                  Report.find({ organizations: { $elemMatch: { _id : userObj.organization._id } } }, function(err, docs) {
                    if (err) {
                      res.send({"status": "500", "message": "Report list retrieved error."});
                    }

                    res.send(docs);
                  });
                });
          });
  });
});

router.post('/createReport', function(req, res) {
  // TODO: Add sharing of BigQuery and IAM roles

  var newReport = req.body;
  newReport.createdBy = req.session.passport.user.id;
  newReport.updatedBy = '';
  var result = 0;

  Report.create(newReport, function(err, results) {
    if (err) {
      res.send({ status: '500', message: 'Report creation error.' });
    } else {
      var orgList = newReport.organizations;
      var file_url = newReport.link;
      var extract_id = file_url.match(/reporting\/.*\/page/i);
      var file_id = extract_id.toString().split('/')[1];

      var filesIdList = [file_id];
      for (var i = 0; i < newReport.dataStudioSourceIDs.length; i++) {
        var datasourcelink = newReport.dataStudioSourceIDs[i];
        var extract_ds_link = datasourcelink.match(/datasources\/.*/i);
        var datasource_id = extract_ds_link.toString().split('/')[1];

        filesIdList.push(datasource_id);
      }

      User.find(function(err1, docs) {
        if (err1) {
          res.send({ status: '500', message: 'Retrieving users error.' });
        }
        var permsList = [];

        for (var i = 0; i < docs.length; i++) {
            for (var j = 0; j < orgList.length; j++) {
              for (var k = 0; k < docs[i].organizations.length; k++) {
                  if ((orgList[j]._id === docs[i].organizations[k]._id)&&(docs[i]._id.toString() !== req.session.passport.user.id)) {
                    permsList.push({
                        'type': 'user',
                        'role': 'reader',
                        'emailAddress': docs[i].googleID
                      });
                  }
              }
            }
          }

          for (var j = 0; j < filesIdList.length; j++) {
            utils.shareReport(filesIdList[j], permsList, 0, function(ret) {
                    if (ret === 1) {
                      console.log("Report sharing failed.");
                      var result = 1;
                    }
                    else {
                      console.log("Report shared successfully.");
                    }
            });
            if (result === 1) {
                res.send({"status": "500", "message": "Sharing report error."});
            }
          }

        for (var i = 0; i < newReport.organizations.length; i++) {
            Organization.updateOne({ _id: newReport.organizations[i]._id }, { $inc: { reportsCount: 1 } }, function(err1, res1) {
              if (err1) {
                res.send({ status: '500', message: err1.message });
              }
            });
        }
        res.send({ status: '200', results: results._id });
      });
    }
  });
});

router.post('/getPermissionsToRevoke', function(req, res) {

  var deleteReport = req.body;

  var permsList = [];
  var filePermsList = [];
  var orgList = deleteReport.organizations;
  var file_url = deleteReport.link;
  var extract_id = file_url.match(/reporting\/.*\/page/i);
  var file_id = extract_id.toString().split('/')[1];

  var filesIdList = [file_id];
  for (var i = 0; i < deleteReport.dataStudioSourceIDs.length; i++) {
    var datasourcelink = deleteReport.dataStudioSourceIDs[i];
    var extract_ds_link = datasourcelink.match(/datasources\/.*/i);
    var datasource_id = extract_ds_link.toString().split('/')[1];

    filesIdList.push(datasource_id);
  }

  User.find(function(err1, docs) {
    if (err1) {
      res.send({ status: '500', message: 'Report creation error.' });
    }
    var usersToRevoke = [];

    for (var i = 0; i < docs.length; i++) {
        for (var j = 0; j < orgList.length; j++) {
          for (var k = 0; k < docs[i].organizations.length; k++) {

            if ((orgList[j]._id === docs[i].organizations[k]._id)&&(docs[i]._id.toString() !== req.session.passport.user.id)) {
                usersToRevoke.push(docs[i].googleID);
             }
          }
        }
    }

    Permission.find({ fileId: { $in: filesIdList }, googleID: { $in: usersToRevoke } }, function(err, docs) {

      if (err) {
        res.send({ status: '500', message: 'Report creation error.' });
      }
      for (var l = 0; l < docs.length; l++) {
        permsList.push(docs[l]);
      }

      res.send({ status: '200', permissions: permsList });
    });
  });

});

router.post('/deleteReport', function(req, res) {
  var deleteReport = req.body.report;
  var permissions = req.body.permissions;
  var result = 0;
  var filePermsList = [];

  Report.deleteOne(deleteReport, function(err, results) {
    if (err) {
      res.send({ status: '500', message: 'Report deletion error.' });
    } else {
      var orgList = deleteReport.organizations;
      var file_url = deleteReport.link;
      var extract_id = file_url.match(/reporting\/.*\/page/i);
      var file_id = extract_id.toString().split('/')[1];

      var filesIdList = [file_id];
      for (var i = 0; i < deleteReport.dataStudioSourceIDs.length; i++) {
        var datasourcelink = deleteReport.dataStudioSourceIDs[i];
        var extract_ds_link = datasourcelink.match(/datasources\/.*/i);
        var datasource_id = extract_ds_link.toString().split('/')[1];

        filesIdList.push(datasource_id);
      }

        utils.shareReport(filesIdList, permissions, 1, function(ret) {
          if (ret === 1) {
            console.log("Report sharing failed.");
            var result = 1;
          }
          else {
            console.log("Report shared successfully.");
          }
        });

        if (result === 1) {
          res.send({"status": "500", "message": "Sharing report error."});
        }

        for (var i = 0; i < deleteReport.organizations.length; i++) {
          Organization.updateOne(
            { _id: deleteReport.organizations[i]._id },
            { $inc: { reportsCount: -1 } },
            function(err1, res1) {
              if (err1) {
                res.send({ status: '500', message: err1.message });
              }
            }
          );
        }
        res.send({ status: '200', results: results._id });
      }
    });
});

router.post('/editReport', (req, res) => {

  var oldReport = req.body.oldReport;
  var newReport = req.body.newReport;

  Report.updateOne({ _id: oldReport._id }, newReport, function(err, results) {
    if (err) {

      res.send({"status": "500", "message": err.message });
    }
    res.send({"status": "200", "message": "Report edit succeeded." });
  });

});


router.get('/getDataRules/:orgid', function(req, res) {
  var rulesByOrg = [];

  Rule.find(function(err, docs) {
    if (err) {
      res.send({ status: '500', message: 'Rule list retrieved error.' });
    } else {
      for (var i = 0; i < docs.length; i++) {
        if (docs[i].organization._id == req.params.orgid) {
          rulesByOrg.push(docs[i]);
        }
      }
      res.send(rulesByOrg);
    }
  });
});

router.post('/createRule', (req, res) => {
  var newRule = req.body;

  var updateRow = utils.buildPermissionsQuery(
    config.bq_instance,
    config.bq_client_dataset,
    config.bq_client_data_perms,
    [newRule.organization._id],
    newRule.identifier,
    newRule.identifierType,
    newRule.condition,
    newRule.token
  );

  bigquery
    .createQueryStream(updateRow)
    .on('error', function(err) {
      res.send({ status: '500', message: err.message });
    })
    .on('data', function(data) {})
    .on('end', function() {
      Rule.create(newRule, function(err, results) {
        if (err) {
          res.send({ status: '500', message: err.message });
        }
        Organization.updateOne(
          { _id: newRule.organization._id },
          { $inc: { datarulesCount: 1 } },
          function(err1, res1) {
            if (err1) {
              res.send({ status: '500', message: err1.message });
            } else {
              res.send({
                status: '200',
                message: 'Rule creation succeeded.',
                results: results
              });
            }
          }
        );
      });
    });
});

router.post('/deleteRule', (req, res) => {
  var delRule = req.body;
  var updateRow = utils.buildPermissionsQuery(
    config.bq_instance,
    config.bq_client_dataset,
    config.bq_client_data_perms,
    [''],
    delRule.identifier,
    delRule.identifierType,
    delRule.condition,
    delRule.token
  );

  bigquery
    .createQueryStream(updateRow)
    .on('error', function(err) {
      res.send({ status: '500', message: err.message });
    })
    .on('data', function(data) {})
    .on('end', function() {
      Rule.deleteOne({ _id: delRule._id }, function(err, results) {
        if (err) {
          res.send({ status: '500', message: err.message });
        }
        Organization.updateOne(
          { _id: delRule.organization._id },
          { $inc: { datarulesCount: -1 } },
          function(err1, res1) {
            if (err1) {
              res.send({ status: '500', message: err1.message });
            } else {
              res.send({
                status: '200',
                message: 'Rule deletion succeeded.',
                results: results
              });
            }
          }
        );
      });
    });
});

router.post('/editRule', (req, res) => {

  var oldRule = req.body.oldRule;
  var newRule = req.body.newRule;

  var updateRow = utils.buildPermissionsQuery(config.bq_instance, config.bq_client_dataset, config.bq_client_data_perms, [""], oldRule.identifier, oldRule.identifierType, oldRule.condition, oldRule.token);

  bigquery.createQueryStream(updateRow)
     .on('error', function(err) {
        res.send({"status": "500", "message": err.message });
     })
     .on('data', function(data) {

     })
     .on('end', function() {

        var secondUpdateRow = utils.buildPermissionsQuery(config.bq_instance, config.bq_client_dataset, config.bq_client_data_perms, [newRule.organization._id], newRule.identifier, newRule.identifierType, newRule.condition, newRule.token);

        bigquery.createQueryStream(secondUpdateRow)
          .on('error', function(err) {
            res.send({"status": "500", "message": err.message });
        })
        .on('data', function(data) {

        })
        .on('end', function() {
          Rule.updateOne({ _id: oldRule._id }, { name: newRule.name, identifier: newRule.identifier, condition: newRule.condition, token: newRule.token, organization: newRule.organization }, function(err, results) {
            if (err) {
              res.send({"status": "500", "message": err.message });
            }

            res.send({"status": "200", "message": "Rule edited successfully." });
          })
        });
     });
});

// route middleware to make sure a user is logged in
router.get('/isLoggedIn', (req, res) => {
  // if user is authenticated in the session, carry on
  if (
    req.session.passport &&
    req.session.passport.user.id &&
    req.session.passport.user != ''
  ) {
    res.send({
      status: '200',
      message: 'User logged in.',
      isLoggedIn: true,
      role: req.session.passport.user.role,
      user: req.session.passport.user.id
    });
  } else {
    res.send({
      status: '403',
      message: 'User not logged in.',
      isLoggedIn: false,
      role: 'None',
      user: 'None'
    });
  }

  // if they aren't redirect them to the home page
});

router.get('/listDatasources', function(req, res) {
  var dsList = [];
  var dataset = bigquery.dataset(config.bq_views_dataset);

  dataset.getTables(function(err, tables) {
    if (err) {
      res.send({ status: '500', message: err.message });
    }

    for (var i = 0; i < tables.length; i++) {
      dsList.push(tables[i].id);
    }
    res.send(dsList);
  });
});

router.get('/listIdentifiers/:name', function(req, res) {
  var table_id = req.params.name;
  var dataset = bigquery.dataset(config.bq_views_dataset);
  var table = dataset.table(table_id);

  table.getMetadata().then(function(data) {
    var identifiers = data[0].schema.fields;

    res.send(identifiers);
  });
});

router.get('/getRole', (req, res) => {
  // if user is authenticated in the session, carry on
  if (
    req.session.passport &&
    req.session.passport.user.role &&
    req.session.passport.user != ''
  ) {
    res.send({
      status: '200',
      message: 'User logged in.',
      role: req.session.passport.user.role
    });
  } else {
    res.send({ status: '403', message: 'User not logged in.', role: 'none' });
  }

  // if they aren't redirect them to the home page
});

//
//
// // router.get('/refreshPermissionsTable', function(req, res) {
// //     var dataset = bigquery.dataset(config.bq_client_dataset);
// //     const dest_table = dataset.table(config.bq_client_data_perms);
// //     const orig_table = dataset.table(config.bq_client_data_base);
// //
// //     dest_table.delete(function(err, apiResponse) {
// //
// //       if ((err)&&(err.code != 404)) {
// //         res.send({"status": "500", "message": err.message });
// //       }
// //       else {
// //           orig_table.copy(dest_table, function(err1, apiResponse1) {
// //
// //              if (err1) {
// //                res.send({"status": "500", "message": err1.message });
// //              }
// //              else {
// //                dest_table.getMetadata().then(function(data) {
// //                    var metadata = data[0];
// //                    var new_schema = metadata.schema.fields;
// //
// //                    new_schema.push({ name: "Permissions", type: "STRING", mode: "REPEATED" });
// //                    metadata.schema.fields = new_schema;
// //
// //                    dest_table.setMetadata(metadata, function(err2, metadata, apiResponse2) {
// //
// //                      if (err2) {
// //                        res.send({"status": "500", "message": err2.message });
// //                      }
// //                      else {
// //
// //                        Rule.find(function(err, docs) {
// //                            if (err) {
// //                              res.send({"status": "500", "message": "Rule list retrieved error."});
// //                            }
// //
// //                            for (var i = 0; i < docs.length; i++) {
// //
// //                               var curr_rule = docs[i];
// //                               var permsList = [];
// //
// //                               for (var j = 0; j < curr_rule.organization.length; j++) {
// //
// //                                 var findId = 'SELECT organization_id FROM `' + config.bq_instance + '.' + config.bq_dataset + '.vendors` WHERE organization = "' + curr_rule.organization[j] + '"';
// //
// //                                 bigquery.createQueryStream(findId)
// //                                    .on('error', function(err) {
// //                                       res.send({"status": "500", "message": err.message });
// //                                    })
// //                                    .on('data', function(row) {
// //                                       permsList.push(row.organization_id);
// //
// //                                       if (permsList.length === curr_rule.organization.length) {
// //
// //                                         var updateRow = utils.buildPermissionsQuery(config.bq_instance, config.bq_client_dataset, config.bq_client_data_perms, permsList, curr_rule.identifier, curr_rule.identifierType, curr_rule.condition, curr_rule.token);
// //
// //                                         bigquery.createQueryStream(updateRow)
// //                                             .on('error', function(err) {
// //                                                res.send({"status": "500", "message": err.message });
// //                                             })
// //                                             .on('data', function(data) {
// //
// //                                             })
// //                                             .on('end', function() {
// //                                                 if (i === docs.length) {
// //                                                   res.send({"status": "200", "message": "Permissions table created.", "schema": metadata.schema.fields });
// //                                                 }
// //
// //                                             })
// //                                       }
// //                                     })
// //                                    .on('end', function() {
// //
// //                                    });
// //
// //                               }
// //                            }
// //                        });
// //
// //                      }
// //                    });
// //                });
// //              }
// //           });
// //       }
// //     });
// // });
//
//
//
//


module.exports = router;
