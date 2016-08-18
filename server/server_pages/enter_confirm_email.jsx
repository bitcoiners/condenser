import koa_router from 'koa-router';
import koa_body from 'koa-body';
import React from 'react';
import { renderToString } from 'react-dom/server';
import models from 'db/models';
import findUser from 'db/utils/find_user';
import config from 'config';
import recordWebEvent from 'server/record_web_event';
import {esc, escAttrs} from 'db/models';
import {emailRegex, getRemoteIp, rateLimitReq, checkCSRF} from '../utils';
import coBody from 'co-body';
import ServerHTML from '../server-html';
import { Link } from 'react-router';
import Icon from 'app/components/elements/Icon.jsx';
import sendEmail from '../sendEmail';

// alter table identities add confirmation_code varchar(256);
// alter table identities drop index identities_email;
// create index `identities_email` ON `identities` (`email`);
// alter table users drop index users_email;
// create index `users_email` ON `users` (`email`);


const assets = require('../webpack-stats.json');

const header = <header className="Header">
    <div className="Header__top header">
        <div className="expanded row">
            <div className="columns">
                <ul className="menu">
                    <li className="Header__top-logo">
                        <a href="/"><Icon name="steem" size="2x" /></a>
                    </li>
                    <li className="Header__top-steemit show-for-medium"><a href="/">steemit<span className="beta">beta</span></a></li>
                </ul>
            </div>
        </div>
    </div>
</header>;

function *confirmEmailHandler() {
    const confirmation_code = this.params && this.params.code ? this.params.code : this.request.body.code;
    console.log('-- /confirm_email -->', this.session.uid, this.session.user, confirmation_code);
    const eid = yield models.Identity.findOne(
        {attributes: ['id', 'user_id', 'verified', 'created_at'], where: {provider: 'email', confirmation_code, verified: false}, order: 'id DESC'}
    );
    if (!eid) {
        this.status = 401;
        this.body = 'confirmation code not found';
        return;
    }
    this.session.user = eid.user_id;
    const hours_ago = (Date.now() - eid.created_at) / 1000.0 / 3600.0;
    if (hours_ago > 24.0) {
        this.status = 401;
        this.body = 'confirmation code not found';
        return;
    }
    if (!eid.verified) yield eid.update({verified: true});
    this.redirect('/create_account');
}

export default function useEnterAndConfirmEmailPages(app) {
    const router = koa_router();
    app.use(router.routes());
    const koaBody = koa_body();

    router.get('/enter_email', function *() {
        console.log('-- /enter_email -->', this.session.uid, this.session.user);
        const user_id = this.session.user;
        if (!user_id) { this.body = 'user not found'; return; }
        const eid = yield models.Identity.findOne(
            {attributes: ['email'], where: {user_id, provider: 'email'}, order: 'id DESC'}
        );
        const body = renderToString(<div className="App">
            {header}
            <br />
            <div className="row">
                <form className="column small-4" action="/submit_email" method="POST">
                    <p>
                        Please provide your email address to continue the registration process.<br />
                        <span className="secondary">This information allows Steemit to assist with Account Recovery in case your account is ever compromised.</span>
                    </p>
                    <input type="hidden" name="csrf" value={this.csrf} />
                    <label>
                        Email
                        <input type="email" name="email" defaultValue={eid ? eid.email : ''} />
                    </label>
                    <br />
                    <input type="submit" className="button" value="CONTINUE" />
                </form>
            </div>
        </div>);
        const props = { body, title: 'Email Address', assets, meta: [] };
        this.body = '<!DOCTYPE html>' + renderToString(<ServerHTML { ...props } />);
    });

    router.post('/submit_email', koaBody, function *() {
        if (!checkCSRF(this, this.request.body.csrf)) return;
        const user_id = this.session.user;
        if (!user_id) { this.body = 'user not found'; return; }
        const email = this.request.body.email;
        if (!email) { this.redirect('/enter_email'); return; }
        console.log('-- /submit_email -->', this.session.uid, this.session.user, email);

        const confirmation_code = Math.random().toString(36).slice(2);
        yield models.Identity.create({
            provider: 'email',
            user_id,
            uid: this.session.uid,
            email,
            verified: false,
            confirmation_code
        });
        sendEmail('confirm_email', email, {confirmation_code});

        const body = renderToString(<div className="App">
            {header}
            <br />
            <div className="row">
                <div className="column">
                    Thank you for providing your email address ({email}).<br />
                    To continue please click on the link in the email we've sent you.
                </div>
            </div>
            <br />
            <div className="row">
                <div className="column">
                    <a href="/enter_email">Re-send email</a>
                </div>
            </div>
            {/*<div className="row">
                <form className="column small-4" action="/confirm_email" method="POST">
                    <label>
                        Confirmation code
                        <input type="text" name="code" />
                    </label>
                    <br />
                    <input type="submit" className="button" value="CONTINUE" />
                </form>
            </div>*/}
        </div>);
        const props = { body, title: 'Email Confirmation', assets, meta: [] };
        this.body = '<!DOCTYPE html>' + renderToString(<ServerHTML { ...props } />);
    });

    router.get('/confirm_email/:code', confirmEmailHandler);
    router.post('/confirm_email', koaBody, confirmEmailHandler);
}